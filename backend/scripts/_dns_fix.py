#!/usr/bin/env python3
"""
Local DNS workaround for the research fetch scripts.

The host's systemd-resolved (127.0.0.53) intermittently fails to resolve
external names while the network itself is fine. This module provides a
minimal pure-Python DNS client (UDP query to 1.1.1.1 / 8.8.8.8) and
monkey-patches socket.getaddrinfo so the fetch scripts keep working.

Usage (at top of a script, before any network call):
    import _dns_fix
    _dns_fix.patch()
"""
import socket
import struct


def _encode_name(name: str) -> bytes:
    out = b""
    for label in name.rstrip(".").split("."):
        out += bytes([len(label)]) + label.encode()
    return out + b"\x00"


def _parse_name(data: bytes, offset: int) -> tuple[str, int]:
    labels = []
    jumped = False
    end = offset
    while True:
        length = data[offset]
        if length & 0xC0 == 0xC0:  # compression pointer
            ptr = struct.unpack("!H", data[offset : offset + 2])[0] & 0x3FFF
            if not jumped:
                end = offset + 2
                jumped = True
            offset = ptr
            continue
        offset += 1
        if length == 0:
            break
        labels.append(data[offset : offset + length].decode())
        offset += length
    return ".".join(labels), (end if jumped else offset)


def resolve_a(host: str, server: str = "1.1.1.1", timeout: float = 3.0) -> list[str]:
    """Resolve A records via a raw DNS query to `server`. Returns list of IPs."""
    tid = 0x1234
    header = struct.pack("!HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    question = _encode_name(host) + struct.pack("!HH", 1, 1)  # A, IN
    query = header + question

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(query, (server, 53))
        data, _ = sock.recvfrom(4096)
    finally:
        sock.close()

    if len(data) < 12:
        return []
    qdcount, ancount = struct.unpack("!HH", data[4:8])
    offset = 12
    for _ in range(qdcount):  # skip questions
        _, offset = _parse_name(data, offset)
        offset += 4
    ips = []
    for _ in range(ancount):
        name, offset = _parse_name(data, offset)
        rtype, rclass, ttl, rdlen = struct.unpack("!HHIH", data[offset : offset + 10])
        offset += 10
        if rtype == 1 and rdlen == 4:  # A record
            ips.append(socket.inet_ntoa(data[offset : offset + 4]))
        offset += rdlen
    return ips


_SERVERS = ("1.1.1.1", "8.8.8.8")
_patched = False


def patch() -> None:
    """Monkey-patch socket.getaddrinfo: try system DNS first, fall back to
    the built-in resolver on failure."""
    global _patched
    if _patched:
        return
    original = socket.getaddrinfo

    def patched_getaddrinfo(host, port, *args, **kwargs):
        try:
            return original(host, port, *args, **kwargs)
        except socket.gaierror:
            if isinstance(host, str):
                for server in _SERVERS:
                    try:
                        ips = resolve_a(host, server=server)
                        if ips:
                            socktype = args[1] if len(args) > 1 and args[1] else socket.SOCK_STREAM
                            family = args[0] if args and args[0] else socket.AF_INET
                            return [
                                (family, socktype, 6, "", (ips[0], port))
                            ]
                    except Exception:
                        continue
            raise

    socket.getaddrinfo = patched_getaddrinfo
    _patched = True
