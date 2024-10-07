export default class Caseless {
  /**
   * @param {*} dict
   */
  constructor(dict) {
    this.dict = dict || {}
  }

  /**
   *
   * @param {*} name
   * @param {*} value
   * @param {*} clobber
   * @returns
   */
  set(name, value, clobber) {
    if (typeof name === 'object') {
      for (const n of name) {
        this.set(n, name[n], value)
      }
    } else {
      if (typeof clobber === 'undefined') clobber = true
      const has = this.has(name)

      if (!clobber && has) this.dict[has] = this.dict[has] + ',' + value
      else this.dict[has || name] = value
      return has
    }
  }

  /**
   *
   * @param {string} name
   * @returns
   */
  has(name) {
    const keys = Object.keys(this.dict)
    name = name.toLowerCase()
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return keys[i]
    }
    return false
  }

  /**
   *
   * @param {string} name
   * @returns
   */
  get(name) {
    name = name.toLowerCase()
    let result
    let _key
    const headers = this.dict
    for (const key of Object.keys(headers)) {
      _key = key.toLowerCase()
      if (name === _key) result = headers[key]
    }
    return result
  }

  /**
   *
   * @param {string} name
   * @returns
   */
  swap(name) {
    const has = this.has(name)
    if (has === name) return
    if (!has) throw new Error('There is no header than matches "' + name + '"')
    this.dict[name] = this.dict[has]
    delete this.dict[has]
  }

  del(name) {
    name = String(name).toLowerCase()
    let deleted = false
    let changed = 0
    const dict = this.dict
    for (const key of Object.keys(this.dict)) {
      if (name === String(key).toLowerCase()) {
        deleted = delete dict[key]
        changed += 1
      }
    }
    return changed === 0 ? true : deleted
  }
}

/**
 *
 * @param {*} resp
 * @param {*} headers
 * @returns
 */
export function httpify(resp, headers) {
  const c = new Caseless(headers)

  resp.setHeader = (key, value, clobber) => {
    if (typeof value === 'undefined') return
    return c.set(key, value, clobber)
  }

  resp.hasHeader = key => {
    return c.has(key)
  }

  resp.getHeader = key => {
    return c.get(key)
  }

  resp.removeHeader = key => {
    return c.del(key)
  }

  resp.headers = c.dict
  return c
}
