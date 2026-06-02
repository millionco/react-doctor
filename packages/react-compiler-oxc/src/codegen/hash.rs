//! A minimal, dependency-free SHA-256 + HMAC-SHA256 used only for the
//! fast-refresh source hash (`enableResetCacheOnSourceFileChanges`).
//!
//! `CodegenReactiveFunction.ts:141` computes the source hash as:
//!
//! ```js
//! createHmac('sha256', fn.env.code).digest('hex')
//! ```
//!
//! Note the subtlety: Node's `createHmac(algorithm, key)` takes the source code
//! as the HMAC **key**, and no `.update(...)` is ever called, so the HMAC message
//! is the empty string. That is exactly what [`hmac_sha256_hex`] reproduces:
//! `HMAC-SHA256(key = source_bytes, message = [])`, hex-encoded (64 lowercase hex
//! chars). Both upstream fixtures' baked-in hashes
//! (`20945b0193e529df…`/`36c02976ff5bc474…`) are reproduced bit-for-bit by this
//! implementation, so no `crypto`/`sha2`/`hmac` dependency is needed.

/// SHA-256 round constants (first 32 bits of the fractional parts of the cube
/// roots of the first 64 primes), per FIPS 180-4 §4.2.2.
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// Initial hash values (first 32 bits of the fractional parts of the square
/// roots of the first 8 primes), per FIPS 180-4 §5.3.3.
const H0: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// The SHA-256 message-block size in bytes.
const BLOCK: usize = 64;

/// SHA-256 of `data`, returned as the raw 32-byte digest (FIPS 180-4).
fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h = H0;

    // Pre-processing (padding): append `0x80`, then `0x00`s until the length is
    // 56 mod 64, then the original bit-length as a big-endian u64.
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % BLOCK != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    let mut w = [0u32; 64];
    for chunk in msg.chunks_exact(BLOCK) {
        // Prepare the message schedule.
        for (i, word) in w.iter_mut().enumerate().take(16) {
            let b = i * 4;
            *word = u32::from_be_bytes([chunk[b], chunk[b + 1], chunk[b + 2], chunk[b + 3]]);
        }
        for i in 16..64 {
            let s0 =
                w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 =
                w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        // Compression.
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// `HMAC-SHA256(key, message)`, hex-encoded (RFC 2104 / FIPS 198-1).
///
/// The fast-refresh hash uses `key = source` and `message = []`.
pub fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    // Block-size the key: hash it down if it is longer than the block, then pad
    // with zeros to a full block.
    let mut block_key = [0u8; BLOCK];
    if key.len() > BLOCK {
        let digest = sha256(key);
        block_key[..32].copy_from_slice(&digest);
    } else {
        block_key[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= block_key[i];
        opad[i] ^= block_key[i];
    }

    // inner = SHA256(ipad || message)
    let mut inner_input = ipad.to_vec();
    inner_input.extend_from_slice(message);
    let inner = sha256(&inner_input);

    // outer = SHA256(opad || inner)
    let mut outer_input = opad.to_vec();
    outer_input.extend_from_slice(&inner);
    let outer = sha256(&outer_input);

    to_hex(&outer)
}

/// Lowercase hex encoding of `bytes` (matching Node's `digest('hex')`).
fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vectors() {
        // NIST: SHA256("") and SHA256("abc").
        assert_eq!(
            to_hex(&sha256(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            to_hex(&sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hmac_sha256_rfc4231_case2() {
        // RFC 4231 Test Case 2: key="Jefe", data="what do ya want for nothing?".
        assert_eq!(
            hmac_sha256_hex(b"Jefe", b"what do ya want for nothing?"),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn fast_refresh_fixture_hashes() {
        // The hash is HMAC-SHA256(key = source, message = ""), matching Node's
        // `createHmac('sha256', source).digest('hex')` with no `.update()`. The
        // key is the verbatim source file bytes (the corpus `.src.js`), so the
        // refs are exercised end-to-end by the corpus parity harness; here we
        // pin the two baked-in hashes against their exact source bytes.
        let reloading = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/corpus/fast-refresh-reloading.src.js"
        ));
        assert_eq!(
            hmac_sha256_hex(reloading.as_bytes(), b""),
            "20945b0193e529df490847c66111b38d7b02485d5b53d0829ff3b23af87b105c"
        );

        let dev = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/corpus/fast-refresh-refresh-on-const-changes-dev.src.js"
        ));
        assert_eq!(
            hmac_sha256_hex(dev.as_bytes(), b""),
            "36c02976ff5bc474b7510128ea8220ffe31d92cd5d245148ed0a43146d18ded4"
        );
    }
}
