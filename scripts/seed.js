const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { demoUsers, demoSpaces, demoBookings, demoReviews } = require('./seedData');

initializeApp({
  credential: cert(require('./serviceAccountKey.json'))
});

const db = getFirestore();

function ensureSearchText(item) {
  if (!item || !item.id) return item;
  const country = item.country || 'Казахстан';
  const sources = [item.title, item.description, item.city, country, item.category]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const prefixes = new Set();

  sources.forEach((words) => {
    words.forEach((_, start) => {
      for (let count = 1; count <= 3 && start + count <= words.length; count += 1) {
        const phrase = words.slice(start, start + count).join(' ');
        for (let length = 2; length <= phrase.length; length += 1) {
          prefixes.add(phrase.slice(0, length));
        }
      }
    });
  });

  return {
    ...item,
    country,
    searchText: [item.title, item.description, item.city, country, item.category]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    searchPrefixes: [...prefixes],
    createdAt: item.createdAt || '2025-01-01T00:00:00.000Z'
  };
}

async function uploadCollection(name, items) {
  for (const item of items.map((entry) => ensureSearchText(entry))) {
    await db.collection(name).doc(String(item.id)).set(item, { merge: true });
    console.log(`✅ Загружено: ${name}/${item.id}`);
  }
}

async function seed() {
  await uploadCollection('users', demoUsers);
  await uploadCollection('spaces', demoSpaces);
  await uploadCollection('reviews', demoReviews);
  await uploadCollection('bookings', demoBookings);
  await uploadCollection('activeBookings', demoBookings.filter((booking) => (
    ['pending', 'confirmed'].includes(booking.status)
  )));

  console.log('🎉 Данные загружены.');
}

seed().catch((error) => {
  console.error('Ошибка при выполнении операции:', error);
  process.exit(1);
});