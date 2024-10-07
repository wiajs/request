import {setTimeout as delay} from 'node:timers/promises'
import {log as Log, name} from '@wiajs/log'
// import request from '@wiajs/request'
import request from '../src/index.js'

const log = Log({env: `wia:agent:${name(import.meta.url)}`}) // __filename

main().catch(err => {
  log.err(err, 'main')
  process.exit(1)
})

async function main() {
  // const rs = (await Req.get('http://file.bunjs.pub:17247/'))?.data
  // log({rs}, 'main')

  // const rs = request.get('http://file.bunjs.pub:17247/', res => {
  const rs = request('http://file.bunjs.pub:17247/', {method: 'get'}, res => {
    let data = ''

    // Accumulate the data
    res.on('data', chunk => {
      data += chunk
    })

    // Resolve the promise once the response ends
    res.on('end', () => {
      log(data.toString())
    })

    res.on('error', err => {
      log.err(err)
    })
  })

  rs.end()

  log(rs)

  // const cfg = _xm02 // 高效
  // await getXMao(cfg.url, cfg.orderno, cfg.secret)
  // await xmao()

  delay(1000)
}
