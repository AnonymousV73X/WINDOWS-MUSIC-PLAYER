const fs = require('fs');
const path = 'c:/Users/user/Downloads/Programs/NovaTune/readme.md';
let content = fs.readFileSync(path, 'utf-8');
content = content.replace(/novatune\/player/g, 'AnonymousV73X/WINDOWS-MUSIC-PLAYER');
fs.writeFileSync(path, content, 'utf-8');
console.log('Done!');
