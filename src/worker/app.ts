import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwk } from 'hono/jwk';
import { ZodError } from 'zod';
import { coffees } from './routes/coffees';
import { recipes } from './routes/recipes';
import { shots } from './routes/shots';
import { images } from './routes/images';
import { system } from './routes/system';
import { ai } from './routes/ai';

export type AppEnv = { Bindings: Env };

export const app = new Hono<AppEnv>().basePath('/api');

/**
 * Login is handled by Cloudflare Access in front of the Worker. As a second line
 * of defence the Worker verifies the Access token on every API request, and
 * refuses everything if Access isn't configured (fails closed).
 */
app.use('*', async (c, next) => {
  if (c.env.AUTH_DISABLED === 'true') return next();
  const team = c.env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const aud = c.env.ACCESS_AUD;
  if (!team || !aud) {
    return c.json({ error: 'Cloudflare Access is not configured (set ACCESS_TEAM_DOMAIN and ACCESS_AUD).' }, 503);
  }
  return jwk({
    jwks_uri: `https://${team}/cdn-cgi/access/certs`,
    headerName: 'Cf-Access-Jwt-Assertion',
    cookie: 'CF_Authorization',
    alg: ['RS256'],
    verification: { aud, iss: `https://${team}` },
  })(c, next);
});

app.route('/', system);
app.route('/coffees', coffees);
app.route('/', recipes);
app.route('/shots', shots);
app.route('/images', images);
app.route('/ai', ai);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || 'Request failed' }, err.status);
  }
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});
