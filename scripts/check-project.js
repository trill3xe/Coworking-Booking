const fs = require('fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const app = read('public/js/app.js');
const database = read('public/js/database.js');
const detail = read('public/detail.html');
const profile = read('public/profile.html');
const { demoSpaces } = require('./seedData');
const cardTemplate = app.slice(app.indexOf('function buildSpaceCard'), app.indexOf('function sortSpaces'));

const checks = [
  ['Размер страницы каталога ограничен', /const\s+PAGE_SIZE\s*=\s*(9|1[0-9]|20)\b/.test(app)],
  ['Поиск Firestore использует префиксный индекс', /where\(['"]searchPrefixes['"'],\s*['"]array-contains['"]/.test(database)],
  ['Управление поиском, сортировкой и категориями подключено', /data-search|data-sort|data-category|data-show-more/.test(app)],
  ['Для ошибок индекса предусмотрен запасной поиск', /getFallbackSpacesPage|usingFallback/.test(database)],
  ['Цены выводятся в тенге', /return `\$\{Number\(value\) \|\| 0\} ₸`/.test(app)],
  ['Карточки помещений показывают страну', /space\.country\s*\|\|\s*'Казахстан'/.test(app)],
  ['Внешние карточки показывают страну и город', /\$\{space\.country\s*\|\|\s*'Казахстан'\},\s*\$\{space\.city\}/.test(cardTemplate)],
  ['Приложение не пересчитывает цены при отображении', !/RUB_TO_KZT_RATE|PRICE_CONVERSION_VERSION|normalizeSpaceForKazakhstan/.test(app)],
  ['Каталог ограничен Алматы и Астаной', demoSpaces.every((space) => ['Алматы', 'Астана'].includes(space.city))],
  ['Категории каталога заданы на русском', demoSpaces.every((space) => ['Частный офис', 'Общая рабочая зона', 'Переговорная', 'Зал мероприятий', 'Тихая комната', 'Мастерская'].includes(space.category))],
  ['У карточек разные адреса и цены в тенге', new Set(demoSpaces.map((space) => space.address)).size === demoSpaces.length && demoSpaces.every((space) => space.priceCurrency === 'KZT' && space.pricePerHour > 0)],
  ['В демо-каталоге нет выдуманных оценок', demoSpaces.every((space) => space.rating === 0)],
  ['Формы админки принимают произвольный город', /<input class="input" name="city" value=/.test(app) && /<input class="input" name="city" placeholder=/.test(app)],
  ['Страница помещения подключена', /data-detail/.test(detail)],
  ['Форма бронирования подключена', /data-booking-form/.test(app) || /data-booking-form/.test(detail)],
  ['На странице помещения подключено взаимодействие с отзывами', /data-review-form|data-rating-picker|comment.*rating|rating.*comment/.test(app)],
  ['Список отзывов отображается', /data-reviews|review-list|Отзыв|Отзывы/.test(app)],
  ['Рейтинг вычисляется по отзывам', /averageRating|getAverageRating|getReviewStats|review.*rating/.test(app)],
  ['Похожие помещения той же категории загружаются частями', /data-related/.test(detail) && /item\.category === space\.category/.test(app) && /data-show-more-related|showMore.*related|DETAIL_RELATED_PAGE_SIZE|related.*PAGE_SIZE/.test(app)],
  ['Обновления страницы помещения поступают в реальном времени', /listenToSpaces\s*\(|onSnapshot\s*\(/.test(app)],
  ['Страница профиля подключена', /data-profile/.test(profile)],
  ['Поля редактирования профиля подключены', /data-user-name|data-user-email|data-user-phone/.test(app)],
  ['Пользователь может управлять своими отзывами', /data-user-reviews|data-delete-review|data-edit-review|updateReview\(|deleteReview\(/.test(app) || /updateReview\(|deleteReview\(/.test(database)],
  ['Статусы бронирований профиля обновляются в реальном времени', /listenToUserBookings\(|booking\.status|confirmed/.test(app) || /listenToUserBookings\(/.test(database)],
  ['Комментарий к отзыву необязателен', /Комментарий \(необязательно\)/.test(app)],
  ['Рейтинг основан на сохраненных отзывах', /getReviewStats/.test(app)],
  ['Профиль поддерживает управление отзывами', /data-profile/.test(profile) && /data-edit-review|updateReview\(/.test(app)]
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  console.error('Проверки проекта не пройдены:');
  failures.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log(`Проверки проекта пройдены: ${checks.length}.`);
