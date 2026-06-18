const https = require('https');
const fs = require('fs');
const path = require('path');

const fontsDir = 'c:\\Users\\user\\Downloads\\Programs\\NovaTune\\renderer\\fonts';

const fonts = {
  'outfit-300.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4W61C4E.ttf',
  'outfit-400.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4TC1C4E.ttf',
  'outfit-500.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4QK1C4E.ttf',
  'outfit-600.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4e6yC4E.ttf',
  'outfit-700.ttf': 'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4deyC4E.ttf'
};

async function downloadFont(name, url) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path.join(fontsDir, name));
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(' Downloaded', name);
        resolve();
      });
    }).on('error', reject);
  });
}

async function downloadAll() {
  try {
    for (const [name, url] of Object.entries(fonts)) {
      await downloadFont(name, url);
    }
    console.log('All Outfit fonts downloaded!');
  } catch (err) {
    console.error('Error:', err);
  }
}

downloadAll();
