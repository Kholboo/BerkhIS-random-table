// Ангийн суудлын сервер — гадны сан шаардахгүй (Node.js 16+)
// Ажиллуулах:  node server.js   →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Хостинг дээр дахин ачаалахад файл устдаг бол DATA_DIR, PHOTO_DIR-ийг байнгын (persistent) дискний замаар зааж өгнө
const PHOTO_DIR = path.resolve(process.env.PHOTO_DIR || path.join(__dirname, 'photos')); // сурагчдын зураг
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));     // жагсаалт, хуваарилалт
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_BODY = 8 * 1024 * 1024;

const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'
};
const UPLOAD_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

[PHOTO_DIR, DATA_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); }
  catch (e) { console.error(`АНХААРУУЛГА: "${d}" хавтсанд бичих боломжгүй — хадгалалт ажиллахгүй. (${e.message})`); }
});

const isWritable = d => { try { fs.accessSync(d, fs.constants.W_OK); return true; } catch (e) { return false; } };

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// photos/ хавтсанд байгаа зургууд. Файлын нэр (өргөтгөлгүй) = сурагчийн id ЭСВЭЛ нэр
function listPhotos() {
  return fs.readdirSync(PHOTO_DIR)
    .filter(f => IMG.has(path.extname(f).toLowerCase()))
    .map(f => ({
      name: path.parse(f).name,
      url: '/photos/' + encodeURIComponent(f) + '?v=' + Math.round(fs.statSync(path.join(PHOTO_DIR, f)).mtimeMs)
    }));
}

function removePhotos(keys) {
  const wanted = new Set(keys.filter(Boolean).map(k => k.normalize('NFC').toLowerCase()));
  fs.readdirSync(PHOTO_DIR).forEach(f => {
    if (IMG.has(path.extname(f).toLowerCase()) && wanted.has(path.parse(f).name.normalize('NFC').toLowerCase())) {
      fs.unlinkSync(path.join(PHOTO_DIR, f));
    }
  });
}

function writeState(obj) {
  const tmp = STATE_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, STATE_FILE); // бүтэн бичигдсэний дараа солино
}

const safeJoin = (base, rel) => {
  const f = path.join(base, rel);
  return f.startsWith(base + path.sep) ? f : null;
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    // ---- API ----
    if (p === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, dataWritable: isWritable(DATA_DIR), photosWritable: isWritable(PHOTO_DIR), stateSaved: fs.existsSync(STATE_FILE) });
    }
    if (p === '/api/state' && req.method === 'GET') {
      let state = null;
      try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* анхны удаа */ }
      return json(res, 200, { state, photos: listPhotos() });
    }
    if (p === '/api/state' && req.method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      if (!body || !Array.isArray(body.students)) return json(res, 400, { error: 'Bad state' });
      body.students.forEach(s => delete s.photo); // зураг нь файл хэлбэрээр хадгалагдана
      writeState(body);
      return json(res, 200, { ok: true });
    }
    const m = p.match(/^\/api\/photos\/([\w-]+)$/);
    if (m && req.method === 'POST') {
      const ext = UPLOAD_EXT[(req.headers['content-type'] || '').split(';')[0].trim()];
      if (!ext) return json(res, 415, { error: 'Unsupported image type' });
      const buf = await readBody(req);
      if (!buf.length) return json(res, 400, { error: 'Empty body' });
      removePhotos([m[1]]);
      fs.writeFileSync(path.join(PHOTO_DIR, m[1] + ext), buf);
      return json(res, 200, { photos: listPhotos() });
    }
    if (m && req.method === 'DELETE') {
      removePhotos([m[1], url.searchParams.get('name')]);
      return json(res, 200, { photos: listPhotos() });
    }

    // ---- Статик файлууд ----
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const isPhoto = p.startsWith('/photos/');
    const file = p === '/' ? path.join(PUBLIC_DIR, 'index.html')
      : isPhoto ? safeJoin(PHOTO_DIR, decodeURIComponent(p.slice(8)))
      : safeJoin(PUBLIC_DIR, decodeURIComponent(p.slice(1)));
    const type = file && MIME[path.extname(file).toLowerCase()];
    if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': isPhoto ? 'public, max-age=86400' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.code === 413 ? 413 : e instanceof SyntaxError ? 400 : 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Сервер ажиллаж байна: http://localhost:${PORT}\nӨгөгдөл: ${DATA_DIR}\nЗураг:   ${PHOTO_DIR}`));
