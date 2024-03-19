import fastify from 'fastify'
import { z } from 'zod'
import { sql } from './lib/postgres'
import postgres from 'postgres'
import { redis } from './lib/redis'

const app = fastify()

app.get('/:code', async (request, reply) => {
  const codeParamsSchema = z.object({
    code: z.string(),
  })

  const { code } = codeParamsSchema.parse(request.params)

  const result = await sql/* sql */ `
    SELECT id, original_url FROM short_links
    WHERE short_links.code = ${code}
  `

  if (result.length === 0) {
    return reply.status(404).send({ message: 'Link not found!' })
  }

  const link = result[0]

  await redis.zIncrBy('hits', 1, String(link.id))

  return reply.redirect(301, link.original_url)
})

app.get('/api/links', async () => {
  const links = await sql/* sql */ `
    SELECT * FROM short_links
    ORDER BY created_at DESC
  `

  return { links }
})

app.post('/api/links', async (request, reply) => {
  const createLinkBodySchema = z.object({
    code: z.string().min(3),
    url: z.string().url(),
  })

  const { code, url } = createLinkBodySchema.parse(request.body)

  try {
    const result = await sql/* sql */ `
    INSERT INTO short_links (code, original_url)
    VALUES (${code}, ${url})
    RETURNING id
  `

    const link = result[0]

    return reply.status(201).send({
      linkId: link.id,
    })
  } catch (err) {
    if (err instanceof postgres.PostgresError) {
      if (err.code === '23505') {
        return reply.status(400).send({ message: 'Duplicated code!' })
      }
    }

    console.error(err)

    return reply.status(500).send({ message: 'Internal server error.' })
  }
})

app.get('/api/hits', async () => {
  const result = await redis.zRangeByScoreWithScores('hits', 0, 50)

  const hits = result
    .toSorted((a, b) => b.score - a.score)
    .map((item) => ({
      linkId: Number(item.value),
      clicks: item.score,
    }))

  return { hits }
})

app
  .listen({
    port: 3333,
  })
  .then(() => {
    console.log('HTTP server running!')
  })
