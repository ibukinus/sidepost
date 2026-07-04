import { BlockList, isIP } from "node:net";

/**
 * IPv4/IPv6アドレスの許可判定。
 *
 * content-api.md 6. の要求（プライベートIP・ループバック・リンクローカル・ULA拒否）を満たす。
 * さらに、SSRFで悪用され得るその他の特殊用途アドレス（CGNAT・マルチキャスト・予約範囲・
 * IPv4射影IPv6等）も防御的に拒否する。判定はNode組み込みの `net.BlockList` を用い、
 * IPアドレスのバイト列を自前でパースしない。
 */

const disallowedAddressList = new BlockList();

// IPv4: RFC 5735 / RFC 6890 等の特殊用途アドレス
const IPV4_DISALLOWED_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved for future use
];

// IPv6: RFC 4291 / RFC 4193 等の特殊用途アドレス
// 注意: `net.BlockList` はIPv4射影IPv6アドレス（`::ffff:a.b.c.d`）をIPv4アドレスとしても
// 照合するため、`::ffff:0:0/96` を明示的にIPv6ルールとして追加する必要はない（追加すると
// 逆にすべてのIPv4アドレスがIPv4射影表現ともマッチしてしまい誤ってブロックされる）。
const IPV6_DISALLOWED_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ["::1", 128], // loopback
  // "::"（未指定アドレス）と非推奨のIPv4互換IPv6アドレス（::a.b.c.d、::1のループバックを含む）
  ["::", 96],
  ["fc00::", 7], // unique local address (ULA)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

for (const [address, prefix] of IPV4_DISALLOWED_SUBNETS) {
  disallowedAddressList.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of IPV6_DISALLOWED_SUBNETS) {
  disallowedAddressList.addSubnet(address, prefix, "ipv6");
}

/**
 * 文字列がIPv4/IPv6リテラルとして解釈できるかを判定する。
 */
export function ipFamily(address: string): 4 | 6 | null {
  const family = isIP(address);
  if (family === 4 || family === 6) {
    return family;
  }
  return null;
}

/**
 * 指定のIPアドレスへの接続を許可してよいかを判定する。
 * IPアドレスとして解釈できない値は安全側に倒して拒否する。
 */
export function isDisallowedAddress(address: string): boolean {
  const family = ipFamily(address);
  if (family === null) {
    return true;
  }
  return disallowedAddressList.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * `SKYSEAL_TRUSTED_PROXIES` 等で使うCIDR表記（例: `203.0.113.0/24`）の構文検証。
 */
export function isValidCidr(cidr: string): boolean {
  const separatorIndex = cidr.lastIndexOf("/");
  if (separatorIndex <= 0 || separatorIndex === cidr.length - 1) {
    return false;
  }
  const address = cidr.slice(0, separatorIndex);
  const prefixText = cidr.slice(separatorIndex + 1);
  const family = isIP(address);
  if (family !== 4 && family !== 6) {
    return false;
  }
  if (!/^\d{1,3}$/.test(prefixText)) {
    return false;
  }
  const prefix = Number(prefixText);
  const maxPrefix = family === 4 ? 32 : 128;
  if (prefix < 0 || prefix > maxPrefix) {
    return false;
  }
  try {
    new BlockList().addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    return true;
  } catch {
    return false;
  }
}
