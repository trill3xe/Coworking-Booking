let firestore = null;
  let auth = null;

  function initialize(config) {
    if (firestore && auth) return true;
    if (!window.firebase || !config || config.apiKey === 'YOUR_API_KEY') return false;

    try {
      const app = window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(config);
      firestore = app.firestore();
      auth = app.auth();
      return true;
    } catch (error) {
      console.warn('Firebase is unavailable. Local fallback will be used.', error);
      return false;
    }
  }

  function isReady() {
    return Boolean(firestore && auth);
  }

  function getAuthenticatedUserId() {
    if (!auth) return Promise.reject(new Error('Firebase Authentication не инициализирован'));
    if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);

    return new Promise((resolve, reject) => {
      let unsubscribe;
      unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe?.();
        resolve(user?.uid || null);
      }, (error) => {
        unsubscribe?.();
        reject(error);
      });
    });
  }

  function getDb() {
    if (!firestore) {
      throw new Error('Firebase Firestore is not initialized');
    }

    return firestore;
  }

  async function getSpaces() {
    const snapshot = await getDb().collection('spaces').get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  function listenToAllSpaces(callback, onError) {
    return getDb().collection('spaces').onSnapshot((snapshot) => {
      callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    }, onError);
  }

  function normalizeSearchText(value) {
    return (String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
  }

  function buildSearchText(space = {}) {
    return [space.title, space.description, space.city, space.country || 'Казахстан', space.category]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function buildSearchPrefixes(space = {}) {
    const sources = [space.title, space.description, space.city, space.country || 'Казахстан', space.category]
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

    return [...prefixes];
  }

  function getSpacesQuery(filters = {}) {
    const { searchText = '', category = 'all', sort = 'rating' } = filters;
    let query = getDb().collection('spaces');
    const term = normalizeSearchText(searchText);
    const sortFields = {
      rating: ['rating', 'desc'],
      date: ['createdAt', 'desc'],
      'price-low': ['pricePerHour', 'asc'],
      'price-high': ['pricePerHour', 'desc']
    };
    const [field, direction] = sortFields[sort] || sortFields.rating;

    if (category && category !== 'all') {
      query = query.where('category', '==', category);
    }
    if (term) {
      query = query.where('searchPrefixes', 'array-contains', term);
    }

    return query.orderBy(field, direction);
  }

  function sortSpaces(items, sort) {
    const sortFields = {
      rating: ['rating', 'desc'],
      date: ['createdAt', 'desc'],
      'price-low': ['pricePerHour', 'asc'],
      'price-high': ['pricePerHour', 'desc']
    };
    const [field, direction] = sortFields[sort] || sortFields.rating;
    return [...items].sort((first, second) => {
      const left = field === 'createdAt' ? String(first[field] || '') : Number(first[field] || 0);
      const right = field === 'createdAt' ? String(second[field] || '') : Number(second[field] || 0);
      return (left < right ? -1 : left > right ? 1 : 0) * (direction === 'asc' ? 1 : -1);
    });
  }

  function filterSpaces(items, filters = {}) {
    const term = normalizeSearchText(filters.searchText);
    const category = filters.category || 'all';
    return sortSpaces(items.filter((space) => {
      const matchesCategory = category === 'all' || space.category === category;
      const matchesSearch = !term || normalizeSearchText(buildSearchText(space)).includes(term);
      return matchesCategory && matchesSearch;
    }), filters.sort || 'rating');
  }

  async function getFallbackSpacesPage(filters = {}, cursor = null, pageSize = 12) {
    const snapshot = await getDb().collection('spaces').get();
    const items = filterSpaces(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), filters);
    const offset = cursor?.fallbackSearch ? cursor.offset : 0;
    const pageItems = items.slice(offset, offset + pageSize);
    const nextOffset = offset + pageItems.length;
    return {
      items: pageItems,
      cursor: nextOffset < items.length ? { fallbackSearch: true, offset: nextOffset } : null,
      hasMore: nextOffset < items.length
    };
  }

  async function getSpacesPage(filters = {}, cursor = null, pageSize = 12) {
    if (cursor?.fallbackSearch) {
      return getFallbackSpacesPage(filters, cursor, pageSize);
    }

    let query = getSpacesQuery(filters).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return {
      items: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      cursor: snapshot.docs[snapshot.docs.length - 1] || null,
      hasMore: snapshot.size === pageSize
    };
  }

  async function getSpaceById(spaceId) {
    const snapshot = await getDb().collection('spaces').doc(spaceId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  function listenToSpaceById(spaceId, callback, onError) {
    return getDb().collection('spaces').doc(spaceId).onSnapshot((snapshot) => {
      callback(snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null);
    }, onError);
  }

  function listenToSpaces(callback, filters = {}, pageSize = 12, onError) {
    let fallbackUnsubscribe = null;
    let usingFallback = false;
    const primaryUnsubscribe = getSpacesQuery(filters).limit(pageSize).onSnapshot((snapshot) => {
      callback({
        items: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        cursor: snapshot.docs[snapshot.docs.length - 1] || null,
        hasMore: snapshot.size === pageSize
      });
    }, (error) => {
      if (usingFallback) {
        onError?.(error);
        return;
      }

      usingFallback = true;
      console.warn('Indexed catalog query failed; using client-side search fallback.', error);
      fallbackUnsubscribe = getDb().collection('spaces').onSnapshot((snapshot) => {
        const items = filterSpaces(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
          filters
        );
        const pageItems = items.slice(0, pageSize);
        callback({
          items: pageItems,
          cursor: items.length > pageSize ? { fallbackSearch: true, offset: pageItems.length } : null,
          hasMore: items.length > pageSize
        });
      }, onError);
    });

    return () => {
      primaryUnsubscribe();
      fallbackUnsubscribe?.();
    };
  }

  async function getUsers() {
    const snapshot = await getDb().collection('users').get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  function listenToUsers(callback) {
    return getDb().collection('users').onSnapshot((snapshot) => {
      callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
  }

  async function setUserRole(uid, role) {
    if (!['user', 'admin'].includes(role)) throw new Error('Недопустимая роль');
    await getDb().collection('users').doc(uid).update({ role });
  }

  async function getUserById(uid) {
    const doc = await getDb().collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  async function createUserProfile(uid, data) {
    const payload = {
      id: uid,
      ...data,
      createdAt: data.createdAt || new Date().toISOString()
    };

    await getDb().collection('users').doc(uid).set(payload, { merge: true });
    return payload;
  }

  async function updateUserProfile(uid, data) {
    const user = auth?.currentUser;
    if (user?.uid === uid && data.email && data.email !== user.email) {
      await user.updateEmail(String(data.email).trim().toLowerCase());
    }
    await getDb().collection('users').doc(uid).update(data);
    return true;
  }

  async function getBookings() {
    const snapshot = await getDb().collection('bookings').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id
    }));
  }

  async function getBookingById(bookingId) {
    if (!bookingId) return null;
    const snapshot = await getDb().collection('bookings').doc(bookingId).get();
    return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
  }

  async function getActiveBookings() {
    const snapshot = await getDb().collection('activeBookings').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  function listenToActiveBookings(callback) {
    return getDb().collection('activeBookings').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
      callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
    });
  }

  function listenToUserActiveBookings(uid, callback, onError) {
    return getDb().collection('activeBookings')
      .where('userId', '==', uid)
      .onSnapshot((snapshot) => {
        const bookings = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
        callback(bookings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
      }, onError);
  }

  function listenToBookings(callback) {
    return getDb()
      .collection('bookings')
      .orderBy('createdAt', 'desc')
      .onSnapshot((snapshot) => {
        callback(snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id
        })));
      });
  }

  function listenToUserBookings(uid, callback, onError) {
    return getDb()
      .collection('bookings')
      .where('userId', '==', uid)
      .onSnapshot((snapshot) => {
        const bookings = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
        callback(bookings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
      }, onError);
  }

  async function getUserBookings(uid) {
    const snapshot = await getDb()
      .collection('bookings')
      .where('userId', '==', uid)
      .get();

    return snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id }))
      .sort((first, second) => String(second.createdAt || '').localeCompare(String(first.createdAt || '')));
  }

  function listenToAllReviews(callback, onError) {
    return getDb().collection('reviews').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
      callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
    }, onError);
  }

  async function getReviews() {
    const snapshot = await getDb().collection('reviews').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return { ...data, id: doc.id };
    });
  }

  function listenToReviews(callback) {
    return getDb()
      .collection('reviews')
      .orderBy('createdAt', 'desc')
      .onSnapshot((snapshot) => {
        callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
      });
  }

  function listenToReviewsBySpaceId(spaceId, callback, onError) {
    return getDb().collection('reviews')
      .where('workspaceId', '==', spaceId)
      .onSnapshot((snapshot) => {
        callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
      }, onError);
  }

  function listenToReviewsByUserId(userId, callback, onError) {
    return getDb().collection('reviews')
      .where('userId', '==', userId)
      .onSnapshot((snapshot) => {
        callback(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
      }, onError);
  }

  async function getReviewsBySpaceId(spaceId) {
    const snapshot = await getDb()
      .collection('reviews')
      .where('workspaceId', '==', spaceId)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return { ...data, id: doc.id };
    });
  }

  async function getReviewsByUserId(userId) {
    const snapshot = await getDb()
      .collection('reviews')
      .where('userId', '==', userId)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return { ...data, id: doc.id };
    });
  }

  async function resolveReviewRef(reviewId) {
    if (!reviewId) return null;

    const directRef = getDb().collection('reviews').doc(reviewId);
    const directSnap = await directRef.get();
    if (directSnap.exists) {
      return { ref: directRef, snapshot: directSnap };
    }

    const fallbackSnapshot = await getDb()
      .collection('reviews')
      .where('id', '==', reviewId)
      .limit(1)
      .get();

    if (!fallbackSnapshot.empty) {
      const doc = fallbackSnapshot.docs[0];
      return { ref: doc.ref, snapshot: doc };
    }

    return null;
  }

  async function createReview(payload) {
    const legacyId = payload.id || `review_${Date.now()}`;
    const ref = getDb().collection('reviews').doc(legacyId);
    await ref.set({
      ...payload,
      id: legacyId,
      createdAt: payload.createdAt || new Date().toISOString()
    });

    return legacyId;
  }

  async function updateReview(reviewId, updates) {
    const match = await resolveReviewRef(reviewId);
    if (!match) {
      return { ok: false, notFound: true };
    }

    const existing = match.snapshot.data();
    await match.ref.update({
      ...updates,
      id: existing.id || reviewId,
      userId: existing.userId,
      userName: existing.userName,
      workspaceId: existing.workspaceId,
      updatedAt: new Date().toISOString()
    });
    return { ok: true };
  }

  async function deleteReview(reviewId) {
    const match = await resolveReviewRef(reviewId);
    if (!match) {
      return { ok: false, notFound: true };
    }
    await match.ref.delete();
    return { ok: true };
  }

  async function resolveSpaceRef(spaceId) {
    if (!spaceId) return null;

    const directRef = getDb().collection('spaces').doc(spaceId);
    const directSnap = await directRef.get();
    if (directSnap.exists) {
      return { ref: directRef, snapshot: directSnap };
    }

    const fallbackSnapshot = await getDb()
      .collection('spaces')
      .where('id', '==', spaceId)
      .limit(1)
      .get();

    if (!fallbackSnapshot.empty) {
      const doc = fallbackSnapshot.docs[0];
      return { ref: doc.ref, snapshot: doc };
    }

    return null;
  }

  async function updateSpaceStatus(spaceId, status, bookingId = null) {
    if (!spaceId) return false;

    const match = await resolveSpaceRef(spaceId);
    const ref = match?.ref || getDb().collection('spaces').doc(spaceId);
    const update = { status, updatedAt: new Date().toISOString() };
    if (status === 'booked' && bookingId) update.lastBookingId = bookingId;
    await ref.update(update);
    return true;
  }


  function escapeEmailHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function getBookingSlotTimes(booking) {
    const match = String(booking.timeSlot || '').match(/^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, startHourRaw, startMinuteRaw, endHourRaw, endMinuteRaw] = match;
    const startHour = Number(startHourRaw);
    const startMinute = Number(startMinuteRaw);
    const endHour = Number(endHourRaw);
    const endMinute = Number(endMinuteRaw);
    if (startHour > 23 || startMinute > 59 || endHour > 24 || endMinute > 59
      || (endHour === 24 && endMinute !== 0)) return null;
    return {
      startMinutes: startHour * 60 + startMinute,
      endMinutes: endHour * 60 + endMinute
    };
  }

  function removeBookingSlot(spaceData, bookingId, date, action) {
    const bookingSlots = spaceData.bookingSlots && typeof spaceData.bookingSlots === 'object'
      && !Array.isArray(spaceData.bookingSlots)
      ? { ...spaceData.bookingSlots }
      : {};
    if (!Object.prototype.hasOwnProperty.call(bookingSlots, bookingId)) return null;
    if (date && bookingSlots[bookingId].date !== date) return null;

    const slotDate = bookingSlots[bookingId].date;
    delete bookingSlots[bookingId];
    return {
      bookingSlots,
      bookingSlotChange: { action, bookingId, date: slotDate },
      updatedAt: new Date().toISOString()
    };
  }

  async function createBooking(payload) {
    const bookingId = payload.id || `booking_${Date.now()}`;
    const booking = {
      ...payload,
      id: bookingId,
      createdAt: payload.createdAt || new Date().toISOString()
    };
    const duration = Number(booking.duration);
    const seats = Number(booking.seats);
    if (!Number.isInteger(seats) || seats < 1) {
      throw new Error('Количество человек должно быть не меньше одного');
    }
    booking.seats = seats;
    if (!Number.isInteger(duration) || duration < 1 || duration > 6) {
      throw new Error('Максимальная продолжительность бронирования — 6 часов');
    }
    const dateParts = String(booking.date || '').split('-').map(Number);
    const selectedDate = dateParts.length === 3
      ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
      : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maximumDate = new Date(today);
    maximumDate.setDate(maximumDate.getDate() + 14);
    const normalizedDate = selectedDate
      ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
      : '';
    if (!selectedDate || Number.isNaN(selectedDate.getTime())
      || normalizedDate !== booking.date || selectedDate < today || selectedDate > maximumDate) {
      throw new Error('Можно бронировать не раньше сегодня и не более чем на 14 дней вперёд');
    }
    const slotTimes = getBookingSlotTimes(booking);
    if (!slotTimes || slotTimes.endMinutes <= slotTimes.startMinutes
      || slotTimes.endMinutes - slotTimes.startMinutes !== duration * 60) {
      throw new Error('Укажите корректный временной интервал бронирования');
    }
    booking.startMinutes = slotTimes.startMinutes;
    booking.endMinutes = slotTimes.endMinutes;
    const currentTime = new Date();
    if (selectedDate.getFullYear() === currentTime.getFullYear()
      && selectedDate.getMonth() === currentTime.getMonth()
      && selectedDate.getDate() === currentTime.getDate()
      && slotTimes.startMinutes <= currentTime.getHours() * 60 + currentTime.getMinutes()) {
      throw new Error('Выберите время позже текущего');
    }
    const endHour = Math.floor(slotTimes.endMinutes / 60);
    const endMinute = slotTimes.endMinutes % 60;
    booking.expiresAt = new Date(`${booking.date}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`);
    if (Number.isNaN(booking.expiresAt.getTime())) throw new Error('Некорректное время окончания аренды');
    const db = getDb();
    if (booking.status !== 'confirmed' || booking.paymentStatus !== 'paid' || booking.paymentMethod !== 'fake-card') {
      throw new Error('Для подтверждения брони завершите демонстрационную оплату');
    }
    if (!booking.userEmail || !booking.workspaceTitle || !booking.address) {
      throw new Error('Не удалось подготовить данные бронирования для письма');
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const activeRef = db.collection('activeBookings').doc(bookingId);
    const spaceRef = db.collection('spaces').doc(String(booking.workspaceId));
    const mailRef = db.collection('mail').doc();
    const escape = escapeEmailHtml;
    const subject = `Бронь подтверждена — ${booking.workspaceTitle}`;
    const details = [
      `Помещение: ${booking.workspaceTitle}`,
      `Адрес: ${booking.city ? `${booking.city}, ` : ''}${booking.address}`,
      `Дата: ${booking.date}`,
      `Время: ${booking.timeSlot}`,
      `Количество гостей: ${booking.seats}`,
      `Продолжительность: ${booking.duration} ч.`,
      `Сумма: ${booking.amount} ₸`,
      `Номер брони: ${bookingId}`
    ];
    const emailText = [
      `Здравствуйте, ${booking.userName || 'гость'}!`,
      '',
      'Бронирование подтверждено. Это письмо — ваш пропуск в бизнес-центр.',
      '',
      ...details,
      '',
      'Покажите это письмо на входе в бизнес-центр.'
    ].join('\n');
    const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h1>Бронирование подтверждено</h1><p>Здравствуйте, ${escape(booking.userName || 'гость')}! Это письмо — ваш пропуск в бизнес-центр.</p><table style="border-collapse:collapse;width:100%">${details.map((detail) => `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escape(detail.split(':')[0])}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>${escape(detail.slice(detail.indexOf(':') + 1).trim())}</strong></td></tr>`).join('')}</table><p>Покажите это письмо на входе в бизнес-центр.</p></div>`;

    await db.runTransaction(async (transaction) => {
      const spaceSnapshot = await transaction.get(spaceRef);
      if (!spaceSnapshot.exists) throw new Error('Рабочая зона не найдена');
      const spaceData = spaceSnapshot.data();
      const capacity = Math.max(1, Number(spaceData.capacity) || 1);
      if (seats > capacity) {
        throw new Error(`В помещении максимум ${capacity} мест`);
      }
      const bookedDates = Array.isArray(spaceData.bookedDates) ? spaceData.bookedDates : [];
      const bookingSlots = spaceData.bookingSlots && typeof spaceData.bookingSlots === 'object'
        && !Array.isArray(spaceData.bookingSlots)
        ? { ...spaceData.bookingSlots }
        : {};
      const isManuallyUnavailable = spaceData.status === 'booked'
        && bookedDates.length === 0
        && Object.keys(bookingSlots).length === 0;
      if (isManuallyUnavailable) throw new Error('Рабочая зона уже занята');

      const existingSlotsOnDate = Object.values(bookingSlots).filter((slot) => slot.date === booking.date);
      if (bookedDates.includes(booking.date) && existingSlotsOnDate.length === 0) {
        throw new Error('На эту дату уже есть бронирование. Выберите другой день.');
      }

      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const hasConflict = existingSlotsOnDate.some((slot) => {
        if (!Number.isInteger(slot.startMinutes) || !Number.isInteger(slot.endMinutes)) return true;
        if (booking.date === normalizedDate && slot.endMinutes <= nowMinutes) return false;
        return slotTimes.startMinutes < slot.endMinutes && slotTimes.endMinutes > slot.startMinutes;
      });
      if (hasConflict) throw new Error('Это время уже занято. Выберите другой интервал.');

      bookingSlots[bookingId] = {
        date: booking.date,
        startMinutes: slotTimes.startMinutes,
        endMinutes: slotTimes.endMinutes
      };

      transaction.set(bookingRef, booking);
      if (['pending', 'confirmed'].includes(booking.status)) {
        transaction.set(activeRef, {
          id: bookingId,
          userId: booking.userId,
          workspaceId: booking.workspaceId,
          date: booking.date,
          timeSlot: booking.timeSlot,
          startMinutes: booking.startMinutes,
          endMinutes: booking.endMinutes,
          duration: booking.duration,
          seats: booking.seats,
          amount: booking.amount,
          status: booking.status,
          expiresAt: booking.expiresAt,
          createdAt: booking.createdAt
        });
        transaction.update(spaceRef, {
          bookingSlots,
          bookingSlotChange: {
            action: 'reserve',
            bookingId,
            date: booking.date,
            startMinutes: booking.startMinutes,
            endMinutes: booking.endMinutes
          },
          updatedAt: new Date().toISOString()
        });
      }
      transaction.set(mailRef, {
        to: booking.userEmail,
        bookingId,
        createdAt: new Date().toISOString(),
        message: { subject, text: emailText, html: emailHtml }
      });
    });
    return bookingId;
  }

  async function updateBookingStatus(bookingId, status) {
    const allowedStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'expired'];
    if (!allowedStatuses.includes(status)) throw new Error('Недопустимый статус бронирования');
    const db = getDb();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const activeRef = db.collection('activeBookings').doc(bookingId);
    const now = new Date().toISOString();

    return db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) throw new Error('Бронирование не найдено');
      const bookingData = bookingSnapshot.data();
      const activeSnapshot = await transaction.get(activeRef);
      const spaceRef = db.collection('spaces').doc(String(bookingData.workspaceId));
      const spaceSnapshot = await transaction.get(spaceRef);

      transaction.update(bookingRef, { status, updatedAt: now });
      if (['pending', 'confirmed'].includes(status)) {
        transaction.set(activeRef, { ...bookingData, status, updatedAt: now });
        if (status === 'confirmed' && spaceSnapshot.exists) {
          transaction.update(spaceRef, {
            status: 'booked',
            lastBookingId: bookingId,
            updatedAt: now
          });
        }
      } else {
        transaction.delete(activeRef);
        if (spaceSnapshot.exists) {
          const spaceData = spaceSnapshot.data();
          const slotRelease = removeBookingSlot(spaceData, bookingId, bookingData.date, 'release');
          if (slotRelease) {
            transaction.update(spaceRef, slotRelease);
          } else {
            const bookedDates = Array.isArray(spaceData.bookedDates) ? spaceData.bookedDates : [];
            if (bookedDates.includes(bookingData.date)) {
              const spaceUpdate = {
                bookedDates: bookedDates.filter((date) => date !== bookingData.date),
                bookingDateChange: { action: 'release', bookingId, date: bookingData.date },
                updatedAt: now
              };
              if (spaceData.lastBookingId === bookingId) spaceUpdate.status = 'available';
              transaction.update(spaceRef, spaceUpdate);
            }
          }
        }
      }
      return true;
    });
  }

  async function deleteBooking(bookingId, hideFromAdmin = false) {
    const db = getDb();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const activeRef = db.collection('activeBookings').doc(bookingId);
    const now = new Date().toISOString();

    return db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) return false;
      const bookingData = bookingSnapshot.data();
      const activeSnapshot = await transaction.get(activeRef);
      const isActive = ['pending', 'confirmed'].includes(bookingData.status);
      const bookingUpdate = { updatedAt: now };
      if (isActive) bookingUpdate.status = 'cancelled';
      if (hideFromAdmin) bookingUpdate.hiddenFromAdmin = true;

      const spaceRef = db.collection('spaces').doc(String(bookingData.workspaceId));
      const spaceSnapshot = await transaction.get(spaceRef);
      transaction.update(bookingRef, bookingUpdate);
      transaction.delete(activeRef);

      if (spaceSnapshot.exists) {
        const spaceData = spaceSnapshot.data();
        const slotRelease = removeBookingSlot(spaceData, bookingId, bookingData.date, 'release');
        if (slotRelease) {
          transaction.update(spaceRef, slotRelease);
        } else {
          const bookedDates = Array.isArray(spaceData.bookedDates) ? spaceData.bookedDates : [];
          if (isActive && bookedDates.includes(bookingData.date)) {
            const spaceUpdate = {
              bookedDates: bookedDates.filter((date) => date !== bookingData.date),
              bookingDateChange: { action: 'release', bookingId, date: bookingData.date },
              updatedAt: now
            };
            if (spaceData.lastBookingId === bookingId) spaceUpdate.status = 'available';
            transaction.update(spaceRef, spaceUpdate);
          }
        }
      }
      return true;
    });
  }

  async function permanentlyDeleteBooking(bookingId) {
    if (!bookingId) return false;
    const db = getDb();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const activeRef = db.collection('activeBookings').doc(bookingId);

    return db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) return false;
      const booking = bookingSnapshot.data();
      const activeSnapshot = await transaction.get(activeRef);
      const spaceRef = db.collection('spaces').doc(String(booking.workspaceId));
      const spaceSnapshot = booking.workspaceId ? await transaction.get(spaceRef) : null;
      const now = new Date().toISOString();

      transaction.delete(bookingRef);
      if (activeSnapshot.exists) transaction.delete(activeRef);

      if (spaceSnapshot?.exists && activeSnapshot.exists) {
        const spaceData = spaceSnapshot.data();
        const activeBooking = activeSnapshot.data();
        const slotRelease = removeBookingSlot(spaceData, bookingId, activeBooking.date, 'orphan-release');
        if (slotRelease) {
          transaction.update(spaceRef, slotRelease);
        } else {
          const bookedDates = Array.isArray(spaceData.bookedDates) ? spaceData.bookedDates : [];
          if (bookedDates.includes(activeBooking.date)) {
            const spaceUpdate = {
              bookedDates: bookedDates.filter((date) => date !== activeBooking.date),
              bookingDateChange: {
                action: 'orphan-release',
                bookingId,
                date: activeBooking.date
              },
              updatedAt: now
            };
            if (spaceData.lastBookingId === bookingId) spaceUpdate.status = 'available';
            transaction.update(spaceRef, spaceUpdate);
          }
        }
      }
      return true;
    });
  }

  async function releaseOrphanedSpaceReservation(spaceId, bookingId, date) {
    if (!spaceId || !bookingId || !date) return false;
    const db = getDb();
    const spaceRef = db.collection('spaces').doc(String(spaceId));

    return db.runTransaction(async (transaction) => {
      const spaceSnapshot = await transaction.get(spaceRef);
      if (!spaceSnapshot.exists) return false;
      const spaceData = spaceSnapshot.data();
      const change = spaceData.bookingDateChange;
      const bookedDates = Array.isArray(spaceData.bookedDates) ? spaceData.bookedDates : [];
      if (change?.action !== 'reserve' || change.bookingId !== bookingId || change.date !== date
        || !bookedDates.includes(date)) return false;

      const spaceUpdate = {
        bookedDates: bookedDates.filter((bookedDate) => bookedDate !== date),
        bookingDateChange: { action: 'orphan-release', bookingId, date },
        updatedAt: new Date().toISOString()
      };
      if (spaceData.lastBookingId === bookingId) spaceUpdate.status = 'available';
      transaction.update(spaceRef, spaceUpdate);
      return true;
    });
  }

  async function releaseOrphanedActiveBooking(bookingId) {
    if (!bookingId) return false;
    const db = getDb();
    const activeRef = db.collection('activeBookings').doc(bookingId);
    const bookingRef = db.collection('bookings').doc(bookingId);

    return db.runTransaction(async (transaction) => {
      const activeSnapshot = await transaction.get(activeRef);
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!activeSnapshot.exists || bookingSnapshot.exists) return false;

      const activeBooking = activeSnapshot.data();
      if (!activeBooking.workspaceId || !activeBooking.date) return false;
      const spaceRef = db.collection('spaces').doc(String(activeBooking.workspaceId));
      const spaceSnapshot = await transaction.get(spaceRef);
      const now = new Date().toISOString();

      transaction.delete(activeRef);
      if (spaceSnapshot.exists) {
        const spaceData = spaceSnapshot.data();
        const slotRelease = removeBookingSlot(spaceData, bookingId, activeBooking.date, 'orphan-release');
        if (slotRelease) {
          transaction.update(spaceRef, slotRelease);
        } else {
          const bookedDates = Array.isArray(spaceData.bookedDates) ? spaceData.bookedDates : [];
          if (bookedDates.includes(activeBooking.date)) {
            const spaceUpdate = {
              bookedDates: bookedDates.filter((date) => date !== activeBooking.date),
              bookingDateChange: {
                action: 'orphan-release',
                bookingId,
                date: activeBooking.date
              },
              updatedAt: now
            };
            if (spaceData.lastBookingId === bookingId) spaceUpdate.status = 'available';
            transaction.update(spaceRef, spaceUpdate);
          }
        }
      }
      return true;
    });
  }

  async function createSpace(data) {
    const spaceId = data.id || `space_${Date.now()}`;
    const normalized = {
      ...data,
      country: data.country || 'Казахстан',
      priceCurrency: 'KZT'
    };
    const payload = {
      ...normalized,
      id: spaceId,
      createdAt: data.createdAt || new Date().toISOString(),
      searchText: buildSearchText(normalized),
      searchPrefixes: buildSearchPrefixes(normalized)
    };

    await getDb().collection('spaces').doc(spaceId).set(payload);
    return spaceId;
  }

  async function updateSpace(spaceId, updates) {
    const match = await resolveSpaceRef(spaceId);
    if (!match) {
      return { ok: false, notFound: true };
    }

    const existing = match.snapshot.data();
    const merged = { country: 'Казахстан', ...existing, ...updates };
    const payload = {
      ...updates,
      country: merged.country,
      priceCurrency: 'KZT',
      updatedAt: new Date().toISOString(),
      searchText: buildSearchText(merged),
      searchPrefixes: buildSearchPrefixes(merged)
    };

    await match.ref.update(payload);
    return { ok: true };
  }

  async function deleteSpace(spaceId) {
    const match = await resolveSpaceRef(spaceId);
    if (match) {
      await match.ref.delete();
      return true;
    }
    await getDb().collection('spaces').doc(spaceId).delete();
    return true;
  }

  async function sendPasswordResetEmail(email) {
    if (!auth) throw new Error('Firebase Authentication не инициализирован');
    await auth.sendPasswordResetEmail(String(email || '').trim().toLowerCase());
  }

  async function signOut() {
    if (auth) await auth.signOut();
  }

export const CoworkingDB = {
    initialize,
    isReady,
    getAuthenticatedUserId,
    getSpaces,
    listenToAllSpaces,
    getSpacesPage,
    getSpaceById,
    listenToSpaceById,
    listenToSpaces,
    getUsers,
    listenToUsers,
    setUserRole,
    getUserById,
    createUserProfile,
    updateUserProfile,
    getBookings,
    getBookingById,
    getActiveBookings,
    listenToActiveBookings,
    listenToUserActiveBookings,
    listenToBookings,
    listenToUserBookings,
    getUserBookings,
    listenToAllReviews,
    getReviews,
    listenToReviews,
    listenToReviewsBySpaceId,
    listenToReviewsByUserId,
    getReviewsBySpaceId,
    getReviewsByUserId,
    createReview,
    updateReview,
    deleteReview,
    createBooking,
    updateBookingStatus,
    updateSpaceStatus,
    deleteBooking,
    permanentlyDeleteBooking,
    releaseOrphanedActiveBooking,
    releaseOrphanedSpaceReservation,
    createSpace,
    updateSpace,
    deleteSpace,
    signOut,
    sendPasswordResetEmail
  };

window.CoworkingDB = CoworkingDB;
