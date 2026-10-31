// Tourne dans le conteneur : vraie app et vrai hasher, compilés dans l'image.
// /login n'existe pas encore dans l'API : cette route reproduit seulement son coût, hasher.verify().
import http from 'node:http';
import {createApp} from '/app/dist/app.js';
import {createContainer} from '/app/dist/container.js';
import {loadConfig} from '/app/dist/config/env.js';
import {ScryptPasswordHasher} from '/app/dist/modules/auth/password-hasher.js';

const config = loadConfig();
const app = createApp(createContainer(config));
const hasher = new ScryptPasswordHasher(config.get('PASSWORD_SCRYPT_LOG2N'));
const stored = await hasher.hash('correct horse battery staple');

http.createServer((req, res) => {
    if (req.url !== '/login') return app(req, res);
    req.resume();
    hasher.verify('correct horse battery staple', stored).then(
        (ok) => {
            res.statusCode = ok ? 200 : 401;
            res.end('{}');
        },
        () => {
            res.statusCode = 500;
            res.end('{}');
        },
    );
}).listen(config.get('PORT'), () => console.log('ready'));
