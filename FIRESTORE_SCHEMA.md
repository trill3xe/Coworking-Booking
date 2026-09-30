# Схема Firestore

Проект использует коллекции `users`, `spaces`, `bookings`, `activeBookings`, `reviews` и `mail`. Подробные ограничения доступа находятся в `config/firestore.rules`, составные индексы — в `firestore.indexes.json`.

Связи документов:

- `users/{uid}`: ID документа совпадает с Firebase Authentication UID.
- `bookings/{bookingId}.userId` ссылается на UID владельца.
- `bookings/{bookingId}.workspaceId` ссылается на `spaces/{spaceId}`.
- `activeBookings/{bookingId}` использует тот же ID, что и соответствующая запись `bookings/{bookingId}`.
- `reviews/{reviewId}.userId` ссылается на UID автора, а `workspaceId` — на пространство.

## `users/{uid}`

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | string | UID Firebase Authentication |
| `email` | string | Адрес электронной почты |
| `name` | string | Имя пользователя |
| `role` | string | `user` или `admin`; по умолчанию `user` |
| `createdAt` | string | Дата создания в ISO 8601 |

Пользователь читает собственный профиль и не может изменить свою роль. Администратор может читать и изменять все профили, а также назначать роли.

## `spaces/{spaceId}`

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | string | ID карточки |
| `title` | string | Название пространства |
| `category` | string | Категория: `Частный офис`, `Общая рабочая зона`, `Переговорная`, `Зал мероприятий`, `Тихая комната` или `Мастерская` |
| `city` | string | Город; поле не ограничено списком городов |
| `country` | string | Страна |
| `address` | string | Адрес |
| `location` | map | Координаты `lat` и `lng`, если заданы |
| `pricePerHour` | number | Цена за час |
| `priceCurrency` | string | Валюта цены, сейчас `KZT` |
| `capacity` | number | Вместимость в людях |
| `description` | string | Описание пространства |
| `features` | array<string> | Удобства |
| `status` | string | `available` или `booked` |
| `rating` | number | Поле каталога для сортировки; отображаемая оценка вычисляется по отзывам |
| `image` | string | URL обложки |
| `images` | array<string> | Дополнительные изображения, если заданы |
| `searchText` | string | Нормализованный текст для поиска |
| `searchPrefixes` | array<string> | Префиксы для индексированного поиска |
| `createdAt`, `updatedAt` | string | Даты в ISO 8601 |
| `lastBookingId` | string | ID последнего подтвержденного бронирования пространства |
| `bookedDates` | array<string> | Даты с активной бронью; доступны для проверки при выборе даты |
| `bookingDateChange` | map | Последнее изменение даты бронирования для проверки правил доступа |

Каталог доступен для чтения. Создавать и удалять пространства может администратор. Дата добавляется в `bookedDates` при создании бронирования и удаляется при отмене, истечении или завершении. При успешном автоматическом подтверждении статус помещения меняется на `booked`.

## `bookings/{bookingId}`

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | string | ID бронирования |
| `userId` | string | UID пользователя |
| `workspaceId` | string | ID пространства |
| `date` | string | Дата брони |
| `timeSlot` | string | Время начала и окончания |
| `duration`, `seats` | number | Длительность в часах и число человек |
| `amount` | number | Итоговая сумма |
| `status` | string | `pending`, `confirmed`, `completed`, `cancelled` или `expired` |
| `hiddenFromAdmin` | boolean | Необязательный флаг: скрыть заказ из общих списков без удаления из истории пользователя |
| `createdAt`, `updatedAt` | string | Даты в ISO 8601 |

Создание оплаченной демонстрационными данными брони выполняется транзакционно: добавляются `bookings`, `activeBookings` и письмо в `mail`, а дата атомарно резервируется в `spaces/{spaceId}.bookedDates`. Статус новой брони — `confirmed`, ожидание подтверждения администратором не требуется. Пользователь читает свои брони; администратор читает и управляет всеми. Реальную доставку писем выполняет установленное расширение Firebase Trigger Email.

## `activeBookings/{bookingId}`

Рабочая копия текущих броней со статусом `pending` или `confirmed`. ID совпадает с `bookingId`. Обычно содержит `id`, `userId`, `workspaceId`, `date`, `timeSlot`, `duration`, `seats`, `amount`, `status`, `expiresAt`, `createdAt`. При отмене, истечении, завершении или удалении администратором активная запись удаляется; основная запись остается в `bookings` для истории пользователя.

## `mail/{mailId}`

Документ очереди Firebase Trigger Email с получателем `to`, ссылкой `bookingId`, датой `createdAt` и сообщением `message.subject`, `message.text`, `message.html`. Клиент может создать письмо только на адрес из своего профиля; читать, менять и удалять очередь из браузера запрещено. Поля карточных реквизитов в документ не записываются.

## `reviews/{reviewId}`

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | string | ID отзыва |
| `userId` | string | UID автора |
| `userName` | string | Отображаемое имя автора |
| `workspaceId` | string | ID пространства |
| `rating` | number | Оценка от 1 до 5 |
| `comment` | string, необязательно | Текст отзыва; оценку можно оставить без комментария |
| `createdAt`, `updatedAt` | string | Даты в ISO 8601 |

Читать отзывы могут все. Создавать отзыв может вошедший пользователь только от своего UID. Изменять или удалять отзыв может его автор либо администратор.

## Поиск, индексы и ограничения SDK

Запросы каталога используют `where`, `orderBy`, `limit` и `startAfter`; индексы заданы в `firestore.indexes.json`. Поиск использует `searchPrefixes`. Клиентский Firebase Web SDK не предоставляет проекцию полей `select()`, доступную некоторым серверным SDK. Поэтому клиентская часть оптимизирует чтение фильтрами, индексами и пагинацией. Firebase Admin SDK и service account не должны попадать в браузерный код.
