import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl, classifyIp, UnsafeUrlError, type Resolver } from './url-guard'

const dns: Record<string, string[]> = {
  'www.greekpeak.net': ['104.21.3.4'],
  'dual.example.com': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
  'rebind.example.com': ['127.0.0.1'],
  'intranet.example.com': ['10.1.2.3'],
  'mixed.example.com': ['93.184.216.34', '192.168.1.10'],
  'metadata.example.com': ['169.254.169.254'],
  'v6private.example.com': ['fd00:ec2::254'],
  'cgnat.example.com': ['100.64.0.1'],
}
const calls: string[] = []
const resolver: Resolver = async (host) => {
  calls.push(host)
  const a = dns[host]
  if (!a) throw new Error('ENOTFOUND')
  return a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}

async function reason(url: string): Promise<string | null> {
  try {
    await assertPublicHttpUrl(url, { resolver })
    return null
  } catch (e) {
    if (e instanceof UnsafeUrlError) return e.reason
    throw e
  }
}

describe('assertPublicHttpUrl', () => {
  it('accepts public http(s) URLs', async () => {
    const r = await assertPublicHttpUrl('https://www.greekpeak.net/ski-ride/current-conditions/', { resolver })
    expect(r.addresses).toEqual(['104.21.3.4'])
    expect(await reason('http://dual.example.com/path?q=1')).toBeNull()
    expect(await reason('https://93.184.216.34/')).toBeNull()
  })

  it('rejects non-http schemes, embedded credentials and odd ports', async () => {
    expect(await reason('file:///etc/passwd')).toBe('scheme')
    expect(await reason('ftp://www.greekpeak.net/')).toBe('scheme')
    expect(await reason('javascript:alert(1)')).toBe('scheme')
    expect(await reason('https://user:pw@www.greekpeak.net/')).toBe('credentials')
    expect(await reason('http://www.greekpeak.net:6379/')).toBe('port')
    expect(await reason('not a url')).toBe('invalid')
  })

  it('rejects loopback, private, link-local/metadata, CGNAT and this-network literals — including odd spellings', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://2130706433/', // decimal 127.0.0.1
      'http://0x7f.1/', // hex/short form
      'http://10.0.0.1/',
      'http://172.16.5.4/',
      'http://172.31.255.255/',
      'http://192.168.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:a9fe:a9fe]/', // mapped 169.254.169.254
      'http://[fd00:ec2::254]/',
      'http://[fe80::1]/',
      'http://[64:ff9b::a00:1]/', // NAT64 of 10.0.0.1
    ]) {
      expect(await reason(url), url).toBe('private-address')
    }
  })

  it('rejects special-use hostnames without resolving them', async () => {
    calls.length = 0
    for (const url of ['http://localhost/', 'http://LOCALHOST./', 'http://api.localhost/', 'http://metadata.google.internal/', 'http://printer.local/', 'http://router/']) {
      expect(await reason(url), url).toBe('hostname')
    }
    expect(calls).toEqual([])
  })

  it('rejects DNS names that resolve to private addresses (any answer)', async () => {
    expect(await reason('http://rebind.example.com/')).toBe('private-address')
    expect(await reason('http://intranet.example.com/')).toBe('private-address')
    expect(await reason('http://mixed.example.com/')).toBe('private-address')
    expect(await reason('http://metadata.example.com/')).toBe('private-address')
    expect(await reason('http://v6private.example.com/')).toBe('private-address')
    expect(await reason('http://cgnat.example.com/')).toBe('private-address')
    expect(await reason('http://does-not-exist.example.com/')).toBe('dns')
  })
})

describe('classifyIp', () => {
  it('draws range boundaries correctly', () => {
    expect(classifyIp('172.15.255.255').public).toBe(true)
    expect(classifyIp('172.32.0.0').public).toBe(true)
    expect(classifyIp('100.63.255.255').public).toBe(true)
    expect(classifyIp('100.128.0.0').public).toBe(true)
    expect(classifyIp('8.8.8.8').public).toBe(true)
    expect(classifyIp('2001:4860:4860::8888').public).toBe(true)
    expect(classifyIp('2002:0a00:0001::1').public).toBe(false) // 6to4 of 10.0.0.1
    expect(classifyIp('224.0.0.1').public).toBe(false)
    expect(classifyIp('not-an-ip').public).toBe(false)
  })
})
