// photos/ хавтсанд байгаа зургийн жагсаалтыг photos.json болгон бичнэ (GitHub Pages-д хэрэгтэй)
// Ажиллуулах:  node make-photo-list.js [хавтас]   эсвэл   npm run photos
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || path.join(__dirname, 'photos'));
const files = fs.readdirSync(dir)
  .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
  .sort();
fs.writeFileSync(path.join(dir, 'photos.json'), JSON.stringify(files, null, 2));
console.log(`${files.length} зураг → ${path.join(dir, 'photos.json')}`);
