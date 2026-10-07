// Browser glue for the web build (see native/web/slate.js, which provides these imports).

extern "C" {
    fn slate_cart_len() -> u32;
    fn slate_cart_read(dst: *mut u8);
    fn slate_store_set(key: *const u8, key_len: u32, val: *const u8, val_len: u32);
    /// length of the stored value (it is then copied by slate_store_take), or -1
    fn slate_store_get(key: *const u8, key_len: u32) -> i32;
    fn slate_store_take(dst: *mut u8);
    fn slate_store_remove(key: *const u8, key_len: u32);
    /// fills 16 buttons (standard mapping) + 4 axes; returns 1 if a pad is connected
    fn slate_pad(dst: *mut f32) -> u32;
    /// editor game view: length of a new cartridge waiting (sprite / map edits), 0 = none;
    /// it is then copied with slate_cart_read
    fn slate_cart_poll() -> u32;
    /// editor game view: the current script error ("" = fixed)
    fn slate_error(text: *const u8, len: u32);
}

/// The cartridge the page loaded (game.slate next to index.html).
pub fn cart() -> Option<Vec<u8>> {
    let n = unsafe { slate_cart_len() } as usize;
    if n == 0 {
        return None;
    }
    let mut v = vec![0u8; n];
    unsafe { slate_cart_read(v.as_mut_ptr()) };
    Some(v)
}

/// A newer cartridge sent by the editor (live edits), if any.
pub fn poll_cart() -> Option<Vec<u8>> {
    let n = unsafe { slate_cart_poll() } as usize;
    if n == 0 {
        return None;
    }
    let mut v = vec![0u8; n];
    unsafe { slate_cart_read(v.as_mut_ptr()) };
    Some(v)
}

pub fn report_error(text: &str) {
    unsafe { slate_error(text.as_ptr(), text.len() as u32) }
}

pub fn store_set(key: &str, val: &str) {
    unsafe { slate_store_set(key.as_ptr(), key.len() as u32, val.as_ptr(), val.len() as u32) }
}

pub fn store_get(key: &str) -> Option<String> {
    let n = unsafe { slate_store_get(key.as_ptr(), key.len() as u32) };
    if n < 0 {
        return None;
    }
    let mut v = vec![0u8; n as usize];
    unsafe { slate_store_take(v.as_mut_ptr()) };
    String::from_utf8(v).ok()
}

pub fn store_remove(key: &str) {
    unsafe { slate_store_remove(key.as_ptr(), key.len() as u32) }
}

pub fn pad(out: &mut [f32; 20]) -> bool {
    unsafe { slate_pad(out.as_mut_ptr()) != 0 }
}
