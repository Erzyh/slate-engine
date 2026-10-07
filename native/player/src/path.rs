// Path finding on tile maps (solid = a tile flag bit, like msolid).
//
//  find(from, to)    A* over the tile grid (8 directions without cutting corners, octile distance),
//                    then the path is pulled tight: corners that can see each other are joined, so
//                    the result is a few straight segments at any angle, not a staircase.
//  toward(from, to)  "Slate steering": the direction to move this frame. When the target is in
//                    sight it is a straight line. Otherwise a distance field is flooded out from the
//                    target's tile once and shared by every caller heading there (a crowd of enemies
//                    costs one flood, and the field is reused until the target changes tile or the map
//                    changes); each caller walks downhill along it and aims at the farthest cell it can
//                    still see, so movement stays smooth and cuts across open rooms.
//  dist(from, to)    walking distance in tiles from the same field (nil = unreachable).

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::rc::Rc;

use crate::engine::Engine;

const STRAIGHT: u32 = 10;
const DIAG: u32 = 14;
const NONE: u32 = u32::MAX;
/// distance fields kept at once (one per target the game is chasing)
const MAX_FIELDS: usize = 16;
/// how far along the field toward() looks for a visible shortcut
const LOOKAHEAD: usize = 16;

pub struct Grid {
    w: usize,
    h: usize,
    solid: Vec<bool>,
}

impl Grid {
    fn blocked(&self, x: i64, y: i64) -> bool {
        x < 0 || y < 0 || x as usize >= self.w || y as usize >= self.h || self.solid[y as usize * self.w + x as usize]
    }

    /// Neighbor cells with their step cost; diagonals only when both sides are open (no corner cutting).
    fn neighbors(&self, i: usize, diagonal: bool, out: &mut Vec<(usize, u32)>) {
        out.clear();
        let (x, y) = ((i % self.w) as i64, (i / self.w) as i64);
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            if !self.blocked(x + dx, y + dy) {
                out.push(((y + dy) as usize * self.w + (x + dx) as usize, STRAIGHT));
            }
        }
        if diagonal {
            for (dx, dy) in [(1, 1), (-1, 1), (1, -1), (-1, -1)] {
                if !self.blocked(x + dx, y + dy) && !self.blocked(x + dx, y) && !self.blocked(x, y + dy) {
                    out.push(((y + dy) as usize * self.w + (x + dx) as usize, DIAG));
                }
            }
        }
    }

    /// Can a straight line from (ax, ay) to (bx, by) (in tile units) pass without touching a solid
    /// cell? Walks every cell the line crosses; passing exactly through a corner needs both sides open.
    fn sight(&self, ax: f64, ay: f64, bx: f64, by: f64) -> bool {
        let (mut x, mut y) = (ax.floor() as i64, ay.floor() as i64);
        let (ex, ey) = (bx.floor() as i64, by.floor() as i64);
        // (starting inside a wall, pushed there by physics, is fine: only the cells after it count)
        let (dx, dy) = (bx - ax, by - ay);
        let (sx, sy) = (dx.signum() as i64, dy.signum() as i64);
        let tdx = if dx != 0.0 { (1.0 / dx).abs() } else { f64::INFINITY };
        let tdy = if dy != 0.0 { (1.0 / dy).abs() } else { f64::INFINITY };
        let mut tx = if dx > 0.0 { (ax.floor() + 1.0 - ax) * tdx } else if dx < 0.0 { (ax - ax.floor()) * tdx } else { f64::INFINITY };
        let mut ty = if dy > 0.0 { (ay.floor() + 1.0 - ay) * tdy } else if dy < 0.0 { (ay - ay.floor()) * tdy } else { f64::INFINITY };
        let mut steps = (ex - x).abs() + (ey - y).abs() + 2;
        while (x, y) != (ex, ey) && steps > 0 {
            steps -= 1;
            if (tx - ty).abs() < 1e-9 {
                // through a corner
                if self.blocked(x + sx, y) || self.blocked(x, y + sy) {
                    return false;
                }
                x += sx;
                y += sy;
                tx += tdx;
                ty += tdy;
            } else if tx < ty {
                x += sx;
                tx += tdx;
            } else {
                y += sy;
                ty += tdy;
            }
            if self.blocked(x, y) {
                return false;
            }
        }
        true
    }
}

struct Field {
    version: u64,
    used: u64,
    dist: Vec<u32>,
}

#[derive(Default)]
pub struct Cache {
    grids: HashMap<(String, u32), (u64, Rc<Grid>)>,
    fields: HashMap<(String, u32, bool, usize), Field>,
    clock: u64,
}

/// Query inputs in pixels; the map's tile size converts them to cells.
pub struct Query<'a> {
    pub map: &'a str,
    pub bit: u32,
    pub diagonal: bool,
}

fn grid(e: &mut Engine, map: &str, bit: u32) -> Option<(Rc<Grid>, f32, f32)> {
    let m = e.maps.get(map)?;
    let (tw, th) = e.tile_size(m)?;
    let key = (map.to_string(), bit);
    if let Some((v, g)) = e.paths.grids.get(&key) {
        if *v == e.map_version {
            return Some((g.clone(), tw, th));
        }
    }
    let mut solid = vec![false; m.w * m.h];
    for (i, s) in solid.iter_mut().enumerate() {
        *s = e.cell_solid(m, (i % m.w) as i64, (i / m.w) as i64, bit);
    }
    let g = Rc::new(Grid { w: m.w, h: m.h, solid });
    e.paths.grids.insert(key, (e.map_version, g.clone()));
    Some((g, tw, th))
}

fn cell(g: &Grid, x: f64, y: f64) -> Option<usize> {
    let (cx, cy) = (x.floor() as i64, y.floor() as i64);
    (cx >= 0 && cy >= 0 && (cx as usize) < g.w && (cy as usize) < g.h).then(|| cy as usize * g.w + cx as usize)
}

fn center(g: &Grid, i: usize) -> (f64, f64) {
    ((i % g.w) as f64 + 0.5, (i / g.w) as f64 + 0.5)
}

/// A* from (x0, y0) to (x1, y1) in pixels. Returns the waypoints in pixels (the start is left out,
/// the last one is the target itself), or None when the target can't be reached.
pub fn find(e: &mut Engine, q: &Query, x0: f32, y0: f32, x1: f32, y1: f32) -> Option<Vec<(f32, f32)>> {
    let (g, tw, th) = grid(e, q.map, q.bit)?;
    let (ax, ay, bx, by) = (x0 as f64 / tw as f64, y0 as f64 / th as f64, x1 as f64 / tw as f64, y1 as f64 / th as f64);
    let (start, goal) = (cell(&g, ax, ay)?, cell(&g, bx, by)?);
    if g.solid[goal] {
        return None;
    }
    if start == goal || g.sight(ax, ay, bx, by) {
        return Some(vec![(x1, y1)]);
    }
    let h = |i: usize| {
        let (dx, dy) = (((i % g.w) as i64 - (goal % g.w) as i64).unsigned_abs() as u32, ((i / g.w) as i64 - (goal / g.w) as i64).unsigned_abs() as u32);
        if q.diagonal { STRAIGHT * dx.max(dy) + (DIAG - STRAIGHT) * dx.min(dy) } else { STRAIGHT * (dx + dy) }
    };
    let mut cost = vec![NONE; g.w * g.h];
    let mut from = vec![usize::MAX; g.w * g.h];
    let mut open = BinaryHeap::new();
    cost[start] = 0;
    open.push(Reverse((h(start), start)));
    let mut nb = Vec::with_capacity(8);
    while let Some(Reverse((_, i))) = open.pop() {
        if i == goal {
            break;
        }
        g.neighbors(i, q.diagonal, &mut nb);
        for &(n, c) in &nb {
            let nc = cost[i] + c;
            if nc < cost[n] {
                cost[n] = nc;
                from[n] = i;
                open.push(Reverse((nc + h(n), n)));
            }
        }
    }
    if cost[goal] == NONE {
        return None;
    }
    let mut cells = vec![goal];
    while let Some(&c) = cells.last() {
        if c == start {
            break;
        }
        cells.push(from[c]);
    }
    cells.reverse();
    // pull the path tight: from each kept point, jump to the farthest point it can see
    let mut pts: Vec<(f64, f64)> = cells.iter().map(|&c| center(&g, c)).collect();
    *pts.first_mut()? = (ax, ay);
    *pts.last_mut()? = (bx, by);
    let mut out = Vec::new();
    let mut i = 0;
    while i < pts.len() - 1 {
        let mut j = pts.len() - 1;
        while j > i + 1 && !g.sight(pts[i].0, pts[i].1, pts[j].0, pts[j].1) {
            j -= 1;
        }
        out.push(((pts[j].0 * tw as f64) as f32, (pts[j].1 * th as f64) as f32));
        i = j;
    }
    Some(out)
}

/// The distance field toward the target's cell (flooded once, shared, reused while valid).
fn field<'a>(e: &'a mut Engine, q: &Query, g: &Grid, goal: usize) -> &'a Field {
    let key = (q.map.to_string(), q.bit, q.diagonal, goal);
    e.paths.clock += 1;
    let (clock, version) = (e.paths.clock, e.map_version);
    let fresh = e.paths.fields.get(&key).is_some_and(|f| f.version == version);
    if !fresh {
        if e.paths.fields.len() >= MAX_FIELDS {
            // forget the least recently used target
            if let Some(old) = e.paths.fields.iter().min_by_key(|(_, f)| f.used).map(|(k, _)| k.clone()) {
                e.paths.fields.remove(&old);
            }
        }
        let mut dist = vec![NONE; g.w * g.h];
        let mut open = BinaryHeap::new();
        if !g.solid[goal] {
            dist[goal] = 0;
            open.push(Reverse((0u32, goal)));
        }
        let mut nb = Vec::with_capacity(8);
        while let Some(Reverse((d, i))) = open.pop() {
            if d > dist[i] {
                continue;
            }
            g.neighbors(i, q.diagonal, &mut nb);
            for &(n, c) in &nb {
                if d + c < dist[n] {
                    dist[n] = d + c;
                    open.push(Reverse((d + c, n)));
                }
            }
        }
        e.paths.fields.insert(key.clone(), Field { version, used: clock, dist });
    }
    let f = e.paths.fields.get_mut(&key).expect("field");
    f.used = clock;
    f
}

/// The cell to leave from: the agent's own cell, or the best open neighbor when physics pushed
/// its center into a wall.
fn start_cell(g: &Grid, dist: &[u32], x: f64, y: f64) -> Option<usize> {
    let c = cell(g, x, y)?;
    if dist[c] != NONE {
        return Some(c);
    }
    let (cx, cy) = ((c % g.w) as i64, (c / g.w) as i64);
    let mut best = None;
    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)] {
        let (nx, ny) = (cx + dx, cy + dy);
        if g.blocked(nx, ny) {
            continue;
        }
        let n = ny as usize * g.w + nx as usize;
        if dist[n] != NONE && best.is_none_or(|b: usize| dist[n] < dist[b]) {
            best = Some(n);
        }
    }
    best
}

/// Direction (unit vector) to move from (x, y) toward (tx, ty) this frame, plus the walking
/// distance in pixels. None when the target can't be reached.
pub fn toward(e: &mut Engine, q: &Query, x: f32, y: f32, tx: f32, ty: f32) -> Option<(f32, f32, f32)> {
    let (g, tw, th) = grid(e, q.map, q.bit)?;
    let (ax, ay, bx, by) = (x as f64 / tw as f64, y as f64 / th as f64, tx as f64 / tw as f64, ty as f64 / th as f64);
    let goal = cell(&g, bx, by)?;
    let unit = |dx: f64, dy: f64| {
        let l = (dx * dx + dy * dy).sqrt();
        if l < 1e-9 { (0.0, 0.0) } else { ((dx / l) as f32, (dy / l) as f32) }
    };
    let px = |dx: f64, dy: f64| ((dx * tw as f64).powi(2) + (dy * th as f64).powi(2)).sqrt() as f32;
    if g.solid[goal] {
        return None;
    }
    // in sight: straight at it
    if g.sight(ax, ay, bx, by) {
        let (ux, uy) = unit((bx - ax) * tw as f64, (by - ay) * th as f64);
        return Some((ux, uy, px(bx - ax, by - ay)));
    }
    let f = field(e, q, &g, goal);
    let start = start_cell(&g, &f.dist, ax, ay)?;
    // walk downhill and aim at the farthest cell still in sight
    let mut cur = start;
    let mut aim = None;
    let mut nb = Vec::with_capacity(8);
    for _ in 0..LOOKAHEAD {
        g.neighbors(cur, q.diagonal, &mut nb);
        let Some(&(next, _)) = nb.iter().filter(|(n, _)| f.dist[*n] < f.dist[cur]).min_by_key(|(n, _)| f.dist[*n]) else { break };
        let (cx, cy) = center(&g, next);
        if aim.is_some() && !g.sight(ax, ay, cx, cy) {
            break;
        }
        aim = Some(next);
        cur = next;
    }
    let (cx, cy) = center(&g, aim?);
    let (ux, uy) = unit((cx - ax) * tw as f64, (cy - ay) * th as f64);
    let walk = f.dist[start] as f32 / STRAIGHT as f32 * tw.max(th);
    Some((ux, uy, walk))
}

/// Walking distance in tiles from (x, y) to (tx, ty), None when unreachable.
pub fn dist(e: &mut Engine, q: &Query, x: f32, y: f32, tx: f32, ty: f32) -> Option<f32> {
    let (g, tw, th) = grid(e, q.map, q.bit)?;
    let goal = cell(&g, tx as f64 / tw as f64, ty as f64 / th as f64)?;
    if g.solid[goal] {
        return None;
    }
    let f = field(e, q, &g, goal);
    let start = start_cell(&g, &f.dist, x as f64 / tw as f64, y as f64 / th as f64)?;
    Some(f.dist[start] as f32 / STRAIGHT as f32)
}
