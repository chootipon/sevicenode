const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();
app.use(express.json());

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const LINE_TOKEN = process.env.LINE_TOKEN || 'fapUjcRTdRNa4kivEv+lp41nTcw+wXXJYPWvoyQjqwifE2z/9yR69lwOKs8Q4c13UAWq9/7D5+Y/6ps/5e6BNU6VOgLHEezr1LXN/ovvibm1CpNPHbzcvEbcGXBXyu1JRKcP/tilej2lFxjgGg8RIgdB04t89/1O/w1cDnyilFU=';

const FEATURES = {
  THEMED_CARDS: true,
  FUZZY_SEARCH: true,
  CATEGORY_SEARCH: true,
  QUICK_REPLY: true
};

// ดึง courses ที่เปิดสอนจาก Firestore
// ดึง courses ที่เปิดสอนจาก Firestore
async function getOpenCourses() {
  const courses = [];
  try {
    const snapshot = await db.collection('courses').get();
    console.log('Firestore snapshot size:', snapshot.size);
    snapshot.forEach(doc => {
      const data = doc.data();
      // เช็ค field active เป็น true เท่านั้น
      if (data.active === true) {
        courses.push({
          id: doc.id,
          title: data.title || '',
          description: data.description || '',
          image: data.image || '',
          link: data.link || '',
          price: data.price || '',
          status: data.status || '',
          category: data.category || '',
          keyword: data.keyword || ''
        });
      }
    });
    console.log('Filtered courses:', courses.length);
  } catch (error) {
    console.error('Error fetching courses from Firestore:', error);
  }
  return courses;
}


// Webhook รับจาก LINE
app.post('/webhook', (req, res) => {
  res.status(200).send('OK');
  const events = req.body.events;
  if (!events || events.length === 0) return;
  events.forEach(event => handleEvent(event).catch(console.error));
});

// จัดการแต่ละ event
async function handleEvent(event) {
  const userMessage = event.message?.text?.toLowerCase();
  const replyToken = event.replyToken;
  if (!userMessage || !replyToken) return;

  const courses = await getOpenCourses();

  if (userMessage.includes('ดูคอร์สทั้งหมด')) {
    if (courses.length === 0) {
      await sendTextReply(replyToken, 'ขณะนี้ยังไม่มีคอร์สที่เปิดสอนค่ะ');
    } else {
      await sendCoursesFlexInChunks(replyToken, courses);
    }
    return;
  }

  if (userMessage.includes('หมวดหมู่')) {
    const category = userMessage.split('หมวดหมู่')[1].trim();
    const filtered = courses.filter(c => (c.category || '').toLowerCase().includes(category));
    if (filtered.length > 0) {
      await sendCoursesFlexInChunks(replyToken, filtered);
    } else {
      await sendTextReply(replyToken, `ไม่พบคอร์สในหมวดหมู่ "${category}"`);
    }
    return;
  }

  const matchedCourses = courses.filter(c =>
    (c.keyword || '').split(',').some(k => fuzzyMatch(userMessage, k)) ||
    fuzzyMatch(userMessage, c.title.toLowerCase())
  );

  if (matchedCourses.length > 0) {
    await sendCoursesFlexInChunks(replyToken, matchedCourses);
  } else {
    await sendTextWithQuickReply(replyToken, 'ไม่พบคอร์สที่เกี่ยวข้อง ลองเลือกจากเมนูด้านล่างนะคะ 👇');
  }
}

// fuzzy match แบบง่าย
function fuzzyMatch(input, target) {
  const i = input.toLowerCase().replace(/\s+/g, '');
  const t = target.toLowerCase().replace(/\s+/g, '');
  return t.includes(i) || i.includes(t);
}

// ส่ง Flex เป็นหลายรอบ (ถ้าเกิน 12)
async function sendCoursesFlexInChunks(replyToken, courses) {
  const chunks = [];
  for (let i = 0; i < courses.length; i += 12) {
    chunks.push(courses.slice(i, i + 12));
  }

  for (let i = 0; i < chunks.length; i++) {
    const message = {
      type: 'flex',
      altText: 'แนะนำคอร์สเรียน',
      contents: {
        type: 'carousel',
        contents: chunks[i].map(createFlexCard)
      }
    };
    await replyMessage(replyToken, message);
    if (i < chunks.length - 1) await delay(1000); // ป้องกัน rate-limit
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// สร้าง Flex card
function createFlexCard(course) {
  const card = {
    type: 'bubble',
    size: 'mega',
    hero: {
      type: 'image',
      url: course.image || 'https://via.placeholder.com/640x360?text=No+Image',
      size: 'full',
      aspectRatio: '16:9',
      aspectMode: 'cover'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'text',
          text: course.title,
          weight: 'bold',
          size: 'xl',
          color: FEATURES.THEMED_CARDS ? '#C1440E' : '#000000',
          wrap: true
        },
        {
          type: 'text',
          text: course.description,
          size: 'sm',
          color: '#555555',
          wrap: true
        },
        {
          type: 'separator',
          margin: 'md'
        },
        {
          type: 'text',
          text: '💰 ราคา: ' + course.price + ' บาท',
          size: 'md',
          weight: 'bold',
          color: '#008080'
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#FFA07A',
          action: {
            type: 'uri',
            label: 'สมัครคอร์ส',
            uri: course.link || 'https://your-default-link.com'
          }
        }
      ]
    }
  };

  if (FEATURES.THEMED_CARDS) {
    card.styles = {
      body: { backgroundColor: '#FFF8F0' },
      footer: { backgroundColor: '#FFF0E0' }
    };
  }

  return card;
}

// ฟังก์ชันส่งข้อความแบบ reply
function replyMessage(replyToken, message) {
  return axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken: replyToken,
      messages: [message]
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_TOKEN}`
      }
    }
  );
}

// ข้อความธรรมดา
function sendTextReply(replyToken, text) {
  return replyMessage(replyToken, {
    type: 'text',
    text: text
  });
}

// ข้อความพร้อม quick reply
function sendTextWithQuickReply(replyToken, text) {
  return replyMessage(replyToken, {
    type: 'text',
    text: text,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: 'ดูคอร์สทั้งหมด', text: 'ดูคอร์สทั้งหมด' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'หมวดหมู่ เบเกอรี่', text: 'หมวดหมู่ เบเกอรี่' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'หมวดหมู่ เค้ก', text: 'หมวดหมู่ เค้ก' }
        }
      ]
    }
  });
}

// Route ทดสอบ
app.get('/test-courses', async (req, res) => {
  const courses = await getOpenCourses();
  res.json(courses);
});

// Route หน้าแรกทดสอบ
app.get('/', (req, res) => {
  res.send('Hello from Glitch! Server is running.');
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
