// Android export: the shell app template (android/template.apk, built by
// tools/build-android-template.mjs) + the web player + the game, as a signed APK.
//
// 1. The template's binary manifest gets the game's package name, title and screen orientation
//    (placeholders long enough for any value are rewritten in place).
// 2. assets/ gets index.html, slate.js, mq_js_bundle.js, slate-player.wasm and game.slate.
// 3. Stored entries are 4-byte aligned (Android needs that for resources.arsc).
// 4. APK Signature Scheme v2 with an ECDSA P-256 key made once per computer and kept in
//    ~/.slate/ (the same key must sign every update of a game; back it up).

use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, ECDSA_P256_SHA256_ASN1_SIGNING};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

static TEMPLATE: &[u8] = include_bytes!("../android/template.apk");
const PACKAGE_PLACEHOLDER: &str = "dev.slate.game.placeholder.placeholder.placeholder.x";
const LABEL_PLACEHOLDER: &str = "Slate game title placeholder placeholder placeholder";

// ------------------------------------------------------------------ zip reading / writing

struct Entry {
    name: String,
    method: u16,
    crc: u32,
    /// the data as stored (compressed when method = 8)
    data: Vec<u8>,
    size: u32,
}

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

fn read_zip(z: &[u8]) -> Result<Vec<Entry>, String> {
    let eocd = (0..z.len().saturating_sub(21)).rev().find(|&i| u32_at(z, i) == 0x0605_4b50).ok_or("template: no end of central directory")?;
    let (count, mut p) = (u16_at(z, eocd + 10) as usize, u32_at(z, eocd + 16) as usize);
    let mut out = Vec::new();
    for _ in 0..count {
        if u32_at(z, p) != 0x0201_4b50 {
            return Err("template: bad central directory".into());
        }
        let (method, crc, csize, size) = (u16_at(z, p + 10), u32_at(z, p + 16), u32_at(z, p + 20) as usize, u32_at(z, p + 24));
        let (nlen, xlen, clen) = (u16_at(z, p + 28) as usize, u16_at(z, p + 30) as usize, u16_at(z, p + 32) as usize);
        let local = u32_at(z, p + 42) as usize;
        let name = String::from_utf8_lossy(&z[p + 46..p + 46 + nlen]).into_owned();
        let data_at = local + 30 + u16_at(z, local + 26) as usize + u16_at(z, local + 28) as usize;
        out.push(Entry { name, method, crc, data: z[data_at..data_at + csize].to_vec(), size });
        p += 46 + nlen + xlen + clen;
    }
    Ok(out)
}

fn stored(name: &str, data: Vec<u8>) -> Entry {
    Entry { name: name.into(), method: 0, crc: crate::crc32(&data), size: data.len() as u32, data }
}

fn deflated(name: &str, data: &[u8]) -> Entry {
    let packed = miniz_oxide::deflate::compress_to_vec(data, 6);
    Entry { name: name.into(), method: 8, crc: crate::crc32(data), size: data.len() as u32, data: packed }
}

/// Write the entries; stored ones start on a 4-byte boundary (padding in the extra field).
/// Returns the zip and where its central directory starts.
fn write_zip(entries: &[Entry]) -> (Vec<u8>, usize) {
    let (mut out, mut central) = (Vec::new(), Vec::new());
    for e in entries {
        let offset = out.len() as u32;
        let name = e.name.as_bytes();
        let mut pad = 0usize;
        if e.method == 0 {
            let data_at = out.len() + 30 + name.len();
            pad = (4 - data_at % 4) % 4;
        }
        let fields = |h: &mut Vec<u8>| {
            h.extend_from_slice(&20u16.to_le_bytes());
            h.extend_from_slice(&0x0800u16.to_le_bytes());
            h.extend_from_slice(&e.method.to_le_bytes());
            h.extend_from_slice(&[0, 0, 0x21, 0]);
            h.extend_from_slice(&e.crc.to_le_bytes());
            h.extend_from_slice(&(e.data.len() as u32).to_le_bytes());
            h.extend_from_slice(&e.size.to_le_bytes());
            h.extend_from_slice(&(name.len() as u16).to_le_bytes());
        };
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        fields(&mut out);
        out.extend_from_slice(&(pad as u16).to_le_bytes());
        out.extend_from_slice(name);
        out.extend(std::iter::repeat_n(0u8, pad));
        out.extend_from_slice(&e.data);
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // made by
        fields(&mut central);
        central.extend_from_slice(&[0; 8]); // extra, comment, disk, internal attributes
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
    }
    let cd = out.len();
    let cd_len = central.len() as u32;
    out.extend(central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_len.to_le_bytes());
    out.extend_from_slice(&(cd as u32).to_le_bytes());
    out.extend_from_slice(&[0; 2]);
    (out, cd)
}

// ------------------------------------------------------------------ binary manifest

/// Rewrite string `from` of the manifest's string pool as `to` (in place: `to` must not be longer).
fn patch_string(xml: &mut [u8], from: &str, to: &str) -> Result<(), String> {
    // the string pool is the first chunk after the 8-byte XML header
    let pool = 8;
    if u16_at(xml, pool) != 0x0001 {
        return Err("manifest: no string pool".into());
    }
    let count = u32_at(xml, pool + 8) as usize;
    let utf8 = u32_at(xml, pool + 16) & (1 << 8) != 0;
    let strings = pool + u32_at(xml, pool + 20) as usize;
    for i in 0..count {
        let at = strings + u32_at(xml, pool + 28 + i * 4) as usize;
        if utf8 {
            // [char count][byte count][bytes][0] (counts of 1 byte when < 128)
            let (clen, mut p) = if xml[at] & 0x80 != 0 { (((xml[at] as usize & 0x7f) << 8) | xml[at + 1] as usize, at + 2) } else { (xml[at] as usize, at + 1) };
            let _ = clen;
            let (blen, q) = if xml[p] & 0x80 != 0 { (((xml[p] as usize & 0x7f) << 8) | xml[p + 1] as usize, p + 2) } else { (xml[p] as usize, p + 1) };
            p = q;
            if &xml[p..p + blen] != from.as_bytes() {
                continue;
            }
            if to.len() > blen || to.len() >= 128 || at + 1 >= p {
                return Err(format!("manifest: \"{to}\" is too long"));
            }
            // keep the header layout: rewrite the counts in their existing widths
            let cw = if xml[at] & 0x80 != 0 { 2 } else { 1 };
            let bw = p - at - cw;
            let mut w = at;
            for (n, width) in [(to.chars().count(), cw), (to.len(), bw)] {
                if width == 2 {
                    xml[w] = 0x80 | (n >> 8) as u8;
                    xml[w + 1] = n as u8;
                } else {
                    xml[w] = n as u8;
                }
                w += width;
            }
            xml[p..p + to.len()].copy_from_slice(to.as_bytes());
            xml[p + to.len()] = 0;
            return Ok(());
        } else {
            // [u16 length][utf-16 chars][u16 0]
            let (len, p) = if u16_at(xml, at) & 0x8000 != 0 { ((((u16_at(xml, at) as usize) & 0x7fff) << 16) | u16_at(xml, at + 2) as usize, at + 4) } else { (u16_at(xml, at) as usize, at + 2) };
            let s: Vec<u16> = (0..len).map(|k| u16_at(xml, p + k * 2)).collect();
            if String::from_utf16_lossy(&s) != from {
                continue;
            }
            let t: Vec<u16> = to.encode_utf16().collect();
            if t.len() > len || p != at + 2 {
                return Err(format!("manifest: \"{to}\" is too long"));
            }
            xml[at..at + 2].copy_from_slice(&(t.len() as u16).to_le_bytes());
            for (k, c) in t.iter().enumerate() {
                xml[p + k * 2..p + k * 2 + 2].copy_from_slice(&c.to_le_bytes());
            }
            xml[p + t.len() * 2..p + t.len() * 2 + 2].copy_from_slice(&0u16.to_le_bytes());
            return Ok(());
        }
    }
    Err(format!("manifest: no \"{from}\""))
}

/// The string pool index of `name` (attribute names are strings too).
fn string_index(xml: &[u8], name: &str) -> Option<u32> {
    let pool = 8;
    let count = u32_at(xml, pool + 8) as usize;
    let utf8 = u32_at(xml, pool + 16) & (1 << 8) != 0;
    let strings = pool + u32_at(xml, pool + 20) as usize;
    (0..count).find(|&i| {
        let at = strings + u32_at(xml, pool + 28 + i * 4) as usize;
        if utf8 {
            let p = if xml[at] & 0x80 != 0 { at + 2 } else { at + 1 };
            let (blen, q) = if xml[p] & 0x80 != 0 { (((xml[p] as usize & 0x7f) << 8) | xml[p + 1] as usize, p + 2) } else { (xml[p] as usize, p + 1) };
            &xml[q..q + blen] == name.as_bytes()
        } else {
            let len = u16_at(xml, at) as usize;
            let s: Vec<u16> = (0..len).map(|k| u16_at(xml, at + 2 + k * 2)).collect();
            String::from_utf16_lossy(&s) == name
        }
    }).map(|i| i as u32)
}

/// Set the integer value of every attribute called `name` (e.g. screenOrientation).
fn patch_int_attr(xml: &mut [u8], name: &str, value: u32) -> Result<(), String> {
    let idx = string_index(xml, name).ok_or(format!("manifest: no {name}"))?;
    let mut p = 8 + u32_at(xml, 12) as usize; // after the string pool
    let mut found = false;
    while p + 8 <= xml.len() {
        let (kind, size) = (u16_at(xml, p), u32_at(xml, p + 4) as usize);
        if size == 0 {
            break;
        }
        if kind == 0x0102 {
            // start element: attributes begin at attributeStart (from the extension at p + 16)
            let ext = p + 16;
            let (start, asize, count) = (u16_at(xml, ext + 8) as usize, u16_at(xml, ext + 10) as usize, u16_at(xml, ext + 12) as usize);
            for k in 0..count {
                let a = ext + start + k * asize;
                if u32_at(xml, a + 4) == idx {
                    // Res_value: size(2) res0(1) type(1) data(4) at a + 12
                    xml[a + 12 + 4..a + 12 + 8].copy_from_slice(&value.to_le_bytes());
                    found = true;
                }
            }
        }
        p += size;
    }
    if found { Ok(()) } else { Err(format!("manifest: no {name} attribute")) }
}

// ------------------------------------------------------------------ signing (APK Signature Scheme v2)

/// The signing key and its certificate, made once and kept in ~/.slate/.
fn signing_key() -> Result<(Vec<u8>, Vec<u8>), String> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map_err(|_| "no home folder")?;
    let dir = PathBuf::from(home).join(".slate");
    let (key_path, cert_path) = (dir.join("android-signing-key.der"), dir.join("android-signing-cert.der"));
    if let (Ok(k), Ok(c)) = (std::fs::read(&key_path), std::fs::read(&cert_path)) {
        return Ok((k, c));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let kp = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).map_err(|e| e.to_string())?;
    let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).map_err(|e| e.to_string())?;
    params.distinguished_name.push(rcgen::DnType::CommonName, "Slate game");
    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    params.not_after = rcgen::date_time_ymd(2099, 12, 31);
    let cert = params.self_signed(&kp).map_err(|e| e.to_string())?;
    let (key, crt) = (kp.serialize_der(), cert.der().to_vec());
    std::fs::write(&key_path, &key).map_err(|e| e.to_string())?;
    std::fs::write(&cert_path, &crt).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("README.txt"), "Slate signs exported Android games with android-signing-key.der.\nKeep a copy: an app can only be updated with the key that signed it.\n").ok();
    Ok((key, crt))
}

fn lp(out: &mut Vec<u8>, data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
}

/// SHA-256 over 1 MB chunks of each section, as v2 defines it.
fn content_digest(sections: &[&[u8]]) -> Vec<u8> {
    let mut chunks = Vec::new();
    let mut n = 0u32;
    for s in sections {
        for c in s.chunks(1 << 20) {
            let mut h = Sha256::new();
            h.update([0xa5]);
            h.update((c.len() as u32).to_le_bytes());
            h.update(c);
            chunks.extend_from_slice(&h.finalize());
            n += 1;
        }
    }
    let mut h = Sha256::new();
    h.update([0x5a]);
    h.update(n.to_le_bytes());
    h.update(&chunks);
    h.finalize().to_vec()
}

fn sign_v2(zip: Vec<u8>, cd: usize) -> Result<Vec<u8>, String> {
    const ALGO: u32 = 0x0201; // ECDSA with SHA2-256
    let (key, cert) = signing_key()?;
    let rng = SystemRandom::new();
    let kp = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &key, &rng).map_err(|e| format!("signing key: {e}"))?;
    let eocd = zip.len() - 22;
    let digest = content_digest(&[&zip[..cd], &zip[cd..eocd], &zip[eocd..]]);

    let mut signed = Vec::new();
    let mut digests = Vec::new();
    let mut d = Vec::new();
    d.extend_from_slice(&ALGO.to_le_bytes());
    lp(&mut d, &digest);
    lp(&mut digests, &d);
    lp(&mut signed, &digests);
    let mut certs = Vec::new();
    lp(&mut certs, &cert);
    lp(&mut signed, &certs);
    lp(&mut signed, &[]); // additional attributes

    let sig = kp.sign(&rng, &signed).map_err(|_| "signing failed")?;
    let mut sigs = Vec::new();
    let mut s = Vec::new();
    s.extend_from_slice(&ALGO.to_le_bytes());
    lp(&mut s, sig.as_ref());
    lp(&mut sigs, &s);
    let spki = spki_of(&kp);

    let mut signer = Vec::new();
    lp(&mut signer, &signed);
    lp(&mut signer, &sigs);
    lp(&mut signer, &spki);
    let mut signers = Vec::new();
    lp(&mut signers, &signer);
    let mut value = Vec::new();
    lp(&mut value, &signers);

    let mut pairs = Vec::new();
    pairs.extend_from_slice(&((4 + value.len()) as u64).to_le_bytes());
    pairs.extend_from_slice(&0x7109_871au32.to_le_bytes());
    pairs.extend_from_slice(&value);
    let size = (pairs.len() + 8 + 16) as u64;
    let mut block = Vec::new();
    block.extend_from_slice(&size.to_le_bytes());
    block.extend_from_slice(&pairs);
    block.extend_from_slice(&size.to_le_bytes());
    block.extend_from_slice(b"APK Sig Block 42");

    let mut out = Vec::with_capacity(zip.len() + block.len());
    out.extend_from_slice(&zip[..cd]);
    out.extend_from_slice(&block);
    out.extend_from_slice(&zip[cd..]);
    let at = out.len() - 22 + 16;
    out[at..at + 4].copy_from_slice(&((cd + block.len()) as u32).to_le_bytes());
    Ok(out)
}

/// SubjectPublicKeyInfo (DER) of a P-256 key.
fn spki_of(kp: &EcdsaKeyPair) -> Vec<u8> {
    use ring::signature::KeyPair;
    let point = kp.public_key().as_ref(); // 65 bytes, uncompressed
    // SEQUENCE { SEQUENCE { id-ecPublicKey, prime256v1 }, BIT STRING point }
    let mut v = vec![0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00];
    v.extend_from_slice(point);
    v
}

// ------------------------------------------------------------------ the export

/// A valid Android package name from a game name: dev.slate.game.<name>.
fn package_of(name: &str) -> String {
    let mut s: String = name.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    if s.is_empty() || s.starts_with(|c: char| c.is_ascii_digit()) {
        s.insert(0, 'g');
    }
    s.truncate(PACKAGE_PLACEHOLDER.len() - "dev.slate.game.".len());
    format!("dev.slate.game.{s}")
}

pub fn build_apk(json: &str, name: &str, title: &str, portrait: bool, web: &[(&str, &[u8])]) -> Result<Vec<u8>, String> {
    let mut entries = read_zip(TEMPLATE)?;
    let manifest = entries.iter_mut().find(|e| e.name == "AndroidManifest.xml").ok_or("template: no manifest")?;
    let mut xml = if manifest.method == 8 {
        miniz_oxide::inflate::decompress_to_vec(&manifest.data).map_err(|_| "template: bad manifest")?
    } else {
        manifest.data.clone()
    };
    patch_string(&mut xml, PACKAGE_PLACEHOLDER, &package_of(name))?;
    let mut label: String = title.chars().take(LABEL_PLACEHOLDER.chars().count()).collect();
    while label.len() > LABEL_PLACEHOLDER.len() {
        label.pop();
    }
    patch_string(&mut xml, LABEL_PLACEHOLDER, &label)?;
    // sensorLandscape = 6, sensorPortrait = 7
    patch_int_attr(&mut xml, "screenOrientation", if portrait { 7 } else { 6 })?;
    *manifest = deflated("AndroidManifest.xml", &xml);

    for (file, data) in web {
        entries.push(deflated(&format!("assets/{file}"), data));
    }
    entries.push(deflated("assets/game.slate", json.as_bytes()));
    // keep resources.arsc stored (and aligned by write_zip)
    for e in entries.iter_mut() {
        if e.name == "resources.arsc" && e.method != 0 {
            let raw = miniz_oxide::inflate::decompress_to_vec(&e.data).map_err(|_| "template: bad resources")?;
            *e = stored("resources.arsc", raw);
        }
    }
    let (zip, cd) = write_zip(&entries);
    sign_v2(zip, cd)
}

#[cfg(test)]
mod tests {
    // SLATE_APK_OUT=path cargo test apk -- --ignored  (then check it with apksigner / aapt2)
    #[test]
    #[ignore]
    fn apk() {
        let out = std::env::var("SLATE_APK_OUT").unwrap();
        let json = r#"{"name":"Test","resolution":[320,180]}"#;
        let web: Vec<(&str, &[u8])> = vec![("index.html", b"<html></html>")];
        let apk = super::build_apk(json, "My Game!", "My Game 한글", false, &web).unwrap();
        std::fs::write(out, apk).unwrap();
    }
}
