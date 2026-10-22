import 'dotenv/config'
import { createApp } from './app.js'
import { migrate } from './db.js'

const port = Number(process.env.PORT ?? 3001)

await migrate()
createApp().listen(port, () => {
    console.log(`FormCheck API on http://localhost:${port}`)
})
