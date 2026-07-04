import { describe, expect, it } from "vitest";
import { ipFamily, isDisallowedAddress, isValidCidr } from "./ip.js";

describe("ipFamily", () => {
  it("IPv4リテラルを判定する", () => {
    expect(ipFamily("192.168.0.1")).toBe(4);
  });

  it("IPv6リテラルを判定する", () => {
    expect(ipFamily("::1")).toBe(6);
  });

  it("IPアドレスでない文字列はnullを返す", () => {
    expect(ipFamily("example.com")).toBeNull();
    expect(ipFamily("")).toBeNull();
  });
});

describe("isDisallowedAddress", () => {
  it.each([
    ["0.0.0.0", "this network"],
    ["10.1.2.3", "private (10/8)"],
    ["100.64.0.1", "CGNAT shared space"],
    ["127.0.0.1", "loopback"],
    ["169.254.1.1", "link-local"],
    ["172.16.0.1", "private (172.16/12)"],
    ["172.31.255.255", "private (172.16/12 upper bound)"],
    ["192.168.1.1", "private (192.168/16)"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
  ])("IPv4の%sを拒否する (%s)", (address) => {
    expect(isDisallowedAddress(address)).toBe(true);
  });

  it.each([
    ["::1", "loopback"],
    ["fc00::1", "unique local address"],
    ["fd00::1", "unique local address (fd)"],
    ["fe80::1", "link-local"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:10.0.0.1", "IPv4-mapped private"],
    ["::", "unspecified address"],
    ["::127.0.0.1", "deprecated IPv4-compatible loopback"],
    ["::10.0.0.1", "deprecated IPv4-compatible private"],
  ])("IPv6の%sを拒否する (%s)", (address) => {
    expect(isDisallowedAddress(address)).toBe(true);
  });

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["203.0.113.10"],
  ])("公開IPv4アドレス%sは許可する", (address) => {
    expect(isDisallowedAddress(address)).toBe(false);
  });

  it.each([
    ["2001:4860:4860::8888"],
    ["2606:4700:4700::1111"],
  ])("公開IPv6アドレス%sは許可する", (address) => {
    expect(isDisallowedAddress(address)).toBe(false);
  });

  it("IPアドレスとして解釈できない値は拒否する", () => {
    expect(isDisallowedAddress("not-an-ip")).toBe(true);
  });
});

describe("isValidCidr", () => {
  it.each([
    "203.0.113.0/24",
    "10.0.0.0/8",
    "2001:db8::/32",
    "::1/128",
  ])("妥当なCIDR %s を受理する", (cidr) => {
    expect(isValidCidr(cidr)).toBe(true);
  });

  it.each([
    "203.0.113.0", // プレフィックス長なし
    "203.0.113.0/",
    "203.0.113.0/33", // IPv4の上限超え
    "2001:db8::/129", // IPv6の上限超え
    "not-an-ip/24",
    "203.0.113.0/abc",
    "",
  ])("不正なCIDR %s を拒否する", (cidr) => {
    expect(isValidCidr(cidr)).toBe(false);
  });
});
