import { requireApi } from "../type/runtime-api";

const bridge = requireApi("bridge");
const call = bridge.call.bind(bridge);

export function hostMd5Hex(input: string): Promise<string> {
  return call("crypto.md5_hex", input ?? "");
}

export function hostAesEcbPkcs7DecryptB64(
  payloadB64: string,
  keyRaw: string,
): Promise<string> {
  return call(
    "crypto.aes_ecb_pkcs7_decrypt_b64",
    payloadB64 ?? "",
    keyRaw ?? "",
  );
}

export function hostGzipDecompress(
  input: Uint8Array | ArrayBuffer | ArrayBufferView,
) {
  return bridge.gzipDecompress(input);
}

export const hostCrypto = {
  md5Hex: hostMd5Hex,
  aesEcbPkcs7DecryptB64: hostAesEcbPkcs7DecryptB64,
  gzipDecompress: hostGzipDecompress,
};
