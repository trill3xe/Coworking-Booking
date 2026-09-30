import { CoworkingDB } from './database.js';
import { initAuthForms } from './login.js';
import { demoBookings, demoReviews, demoSpaces, demoUsers } from './demo-data.js';

window.CoworkingDB = CoworkingDB;

const STORAGE_VERSION = 'coworking_v1';
const PAGE_SIZE = 9;

const catalogStore = {
  spaces: [],
  fullSpaces: [],
  cursor: null,
  hasMore: false,
  loading: false,
  queryKey: '',
  unsubscribe: null
};

let searchDebounceTimer = null;
const DETAIL_RELATED_PAGE_SIZE = 3;

const STORAGE_KEYS = {
  users: 'coworking_users',
  spaces: 'coworking_spaces',
  bookings: 'coworking_bookings',
  activeBookings: 'coworking_active_bookings',
  currentUser: 'coworking_current_user',
  version: 'coworking_version',
  seedSignature: 'coworking_seed_signature',
  reviews: 'coworking_reviews'
};

const reviewStore = {
  items: [],
  error: null
};

let adminDataLoaded = false;
let adminDataPromise = null;

function resetAppStorage() {
  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}


const APP_SEED_SIGNATURE = JSON.stringify({
  users: demoUsers,
  spaces: demoSpaces,
  bookings: demoBookings
});

function loadJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showInlineMessage(message, container = document.querySelector('main'), kind = 'info') {
  if (!message || !container) return;

  let status = container.querySelector('[data-inline-message]');
  if (!status) {
    status = document.createElement('p');
    status.className = 'inline-message';
    status.dataset.inlineMessage = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    container.prepend(status);
  }

  status.dataset.kind = kind;
  status.hidden = false;
  status.textContent = message;
}

window.showInlineMessage = showInlineMessage;

function requestInlineConfirmation(message, anchor) {
  const parent = anchor.closest('.admin-space-row, .history-item, .modal-footer') || anchor.parentElement;
  if (!parent) return Promise.resolve(false);

  return new Promise((resolve) => {
    const confirmation = document.createElement('div');
    confirmation.className = 'inline-confirmation';
    const text = document.createElement('span');
    text.textContent = message;
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'small-btn danger';
    confirmButton.textContent = 'Удалить';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'small-btn';
    cancelButton.textContent = 'Отмена';

    const finish = (confirmed) => {
      confirmation.remove();
      resolve(confirmed);
    };

    confirmButton.addEventListener('click', () => finish(true));
    cancelButton.addEventListener('click', () => finish(false));
    confirmation.append(text, confirmButton, cancelButton);
    parent.insertAdjacentElement('afterend', confirmation);
  });
}

function ensureSeedData() {
  const savedVersion = localStorage.getItem(STORAGE_KEYS.version);
  const savedSignature = localStorage.getItem(STORAGE_KEYS.seedSignature);
  const storedUsers = loadJson(STORAGE_KEYS.users, null);
  const storedSpaces = loadJson(STORAGE_KEYS.spaces, null);
  const storedBookings = loadJson(STORAGE_KEYS.bookings, null);
  const storedActiveBookings = loadJson(STORAGE_KEYS.activeBookings, null);
  const needsSeedReset = savedVersion !== STORAGE_VERSION
    || !Array.isArray(storedUsers)
    || !Array.isArray(storedSpaces)
    || !Array.isArray(storedBookings);

  if (needsSeedReset) {
    resetAppStorage();
    localStorage.setItem(STORAGE_KEYS.version, STORAGE_VERSION);
    saveJson(STORAGE_KEYS.users, demoUsers);
    saveJson(STORAGE_KEYS.spaces, demoSpaces);
    saveJson(STORAGE_KEYS.bookings, demoBookings);
    saveJson(STORAGE_KEYS.activeBookings, []);
    localStorage.removeItem(STORAGE_KEYS.currentUser);
  }

  saveJson(STORAGE_KEYS.spaces, getSpaces());

  if (!Array.isArray(storedActiveBookings)) {
    saveJson(STORAGE_KEYS.activeBookings, getBookings().filter((booking) => (
      ['pending', 'confirmed'].includes(booking.status)
    )));
  }

  if (savedSignature !== APP_SEED_SIGNATURE) {
    const seededSpaceIds = new Set(Array.from({ length: 21 }, (_, index) => `space_${index + 1}`));
    const customSpaces = Array.isArray(storedSpaces)
      ? storedSpaces.filter((space) => (
        !seededSpaceIds.has(space.id) && ['Алматы', 'Астана'].includes(space.city)
      ))
      : [];
    saveJson(STORAGE_KEYS.spaces, [...demoSpaces, ...customSpaces]);
    localStorage.setItem(STORAGE_KEYS.seedSignature, APP_SEED_SIGNATURE);
  }
  if (!Array.isArray(loadJson(STORAGE_KEYS.reviews, null))) {
    saveJson(STORAGE_KEYS.reviews, demoReviews);
  }
  reviewStore.items = loadJson(STORAGE_KEYS.reviews, demoReviews);
}

function getUsers() {
  return loadJson(STORAGE_KEYS.users, demoUsers);
}

function getSpaces() {
  const spaces = loadJson(STORAGE_KEYS.spaces, demoSpaces);
  const catalog = spaces.length || CoworkingDB.isReady() ? spaces : demoSpaces;
  return catalog;
}

function getBookings() {
  return loadJson(STORAGE_KEYS.bookings, demoBookings);
}

function getActiveBookings() {
  return loadJson(STORAGE_KEYS.activeBookings, []);
}

function getCurrentUser() {
  const currentId = localStorage.getItem(STORAGE_KEYS.currentUser);
  if (!currentId) return null;

  const users = getUsers();
  return users.find((user) => user.id === currentId) || null;
}

function getActiveAuthUid() {
  const auth = window.firebase?.auth?.();
  return auth?.currentUser?.uid || getCurrentUser()?.id || null;
}

async function syncReviewOwnerIds() {
  const auth = window.firebase?.auth?.();
  const user = auth?.currentUser;
  if (!user || !window.firebase || !window.firebase.firestore) return;

  const db = window.firebase.firestore();
  const localUser = getCurrentUser();
  const profileName = localUser?.name || user.displayName || (user.email || '').split('@')[0] || 'Пользователь';
  const userProfile = await db.collection('users').doc(user.uid).get();
  const profileRole = userProfile.exists ? userProfile.data().role : 'user';

  await db.collection('users').doc(user.uid).set({
    id: user.uid,
    email: user.email || '',
    name: profileName,
    role: profileRole,
    createdAt: localUser?.createdAt || new Date().toISOString()
  }, { merge: true });

  const reviewsSnapshot = await db.collection('reviews')
    .where('userName', '==', profileName)
    .get();

  await Promise.all(reviewsSnapshot.docs.map((doc) => {
    const reviewData = doc.data();
    if (reviewData.userId !== user.uid) {
      return doc.ref.update({ userId: user.uid });
    }
    return Promise.resolve();
  }));

  const localUsers = JSON.parse(localStorage.getItem('coworking_users') || '[]');
  const existing = localUsers.find((item) => item.id === user.uid);
  if (!existing) {
    localUsers.push({
      id: user.uid,
      email: user.email || '',
      name: profileName,
      role: profileRole,
      createdAt: localUser?.createdAt || new Date().toISOString()
    });
  } else {
    existing.email = user.email || existing.email || '';
    existing.name = profileName;
    existing.role = profileRole;
  }

  localStorage.setItem('coworking_users', JSON.stringify(localUsers));
  localStorage.setItem('coworking_current_user', user.uid);
}

function isAdmin() {
  const user = getCurrentUser();
  return Boolean(user && user.role === 'admin');
}

function setCurrentUser(userId) {
  if (!userId) {
    localStorage.removeItem(STORAGE_KEYS.currentUser);
    return;
  }

  localStorage.setItem(STORAGE_KEYS.currentUser, userId);
}

function logoutCurrentUser() {
  setCurrentUser(null);
  const signOut = window.CoworkingDB?.signOut;
  const redirect = () => {
    window.location.href = 'login.html';
  };

  if (signOut) {
    signOut().catch((error) => console.warn('Logout warning:', error)).finally(redirect);
  } else {
    redirect();
  }
}

function getBookingTimeRange(booking) {
  if (!booking || !booking.date || !booking.timeSlot) return null;

  const match = String(booking.timeSlot).match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const [, startHour, startMinute, endHour, endMinute] = match;
  const start = new Date(`${booking.date}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`);
  const end = new Date(`${booking.date}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return { start, end };
}

function isBookingExpired(booking) {
  if (!booking || ['cancelled', 'completed', 'expired'].includes(booking.status)) return false;
  const range = getBookingTimeRange(booking);
  if (!range) return false;
  return Date.now() > range.end.getTime();
}

function isSpaceOccupied(space) {
  if (!space) return false;

  const bookings = getBookings().filter((booking) => (
    String(booking.workspaceId) === String(space.id)
    && booking.status === 'confirmed'
    && !isBookingExpired(booking)
  ));

  if (space.status === 'booked') {
    if (!space.lastBookingId) return true;
    const lastBooking = getBookings().find((booking) => booking.id === space.lastBookingId);
    if (lastBooking?.status === 'confirmed' && !isBookingExpired(lastBooking)) return true;
  }

  return bookings.length > 0;
}

async function synchronizeExpiredBookings() {
  const expired = getBookings().filter((booking) => booking.status !== 'cancelled' && isBookingExpired(booking));
  if (!expired.length) return;

  const markExpiredLocally = (booking) => {
    saveJson(STORAGE_KEYS.bookings, getBookings().map((item) => (
      item.id === booking.id ? { ...item, status: 'expired' } : item
    )));
    saveJson(STORAGE_KEYS.activeBookings, getActiveBookings().filter((item) => item.id !== booking.id));
    if (!booking.workspaceId) return;
    removeLocalBookedDate(booking.workspaceId, booking.date);
    const space = getSpaces().find((item) => item.id === booking.workspaceId);
    if (space?.lastBookingId === booking.id) setLocalSpaceStatus(booking.workspaceId, 'available');
  };

  if (CoworkingDB.isReady()) {
    await Promise.all(expired.map(async (booking) => {
      try {
        await CoworkingDB.updateBookingStatus(booking.id, 'expired');
        markExpiredLocally(booking);
      } catch (error) {
        console.warn('Could not expire booking; it will be retried:', error);
      }
    }));
  } else {
    expired.forEach(markExpiredLocally);
  }

  renderCatalog();
  renderDetail();
  renderProfile();
  renderBookings();
  renderAdmin();
}

const orphanCleanupInFlight = new Set();

async function reconcileOrphanedActiveBookings(activeBookings = getActiveBookings()) {
  if (!CoworkingDB.isReady()) return;

  await Promise.all(activeBookings.map(async (activeBooking) => {
    if (!activeBooking.id || orphanCleanupInFlight.has(activeBooking.id)) return;
    orphanCleanupInFlight.add(activeBooking.id);
    try {
      const booking = await CoworkingDB.getBookingById(activeBooking.id);
      if (booking) return;
      const cleaned = await CoworkingDB.releaseOrphanedActiveBooking(activeBooking.id);
      if (!cleaned) return;

      saveJson(STORAGE_KEYS.bookings, getBookings().filter((item) => item.id !== activeBooking.id));
      saveJson(STORAGE_KEYS.activeBookings, getActiveBookings().filter((item) => item.id !== activeBooking.id));
      removeLocalBookedDate(activeBooking.workspaceId, activeBooking.date);
      const space = getSpaces().find((item) => item.id === activeBooking.workspaceId);
      if (space?.lastBookingId === activeBooking.id) setLocalSpaceStatus(activeBooking.workspaceId, 'available');
      renderCatalog();
      renderDetail();
      renderBookings();
      renderAdmin();
    } catch (error) {
      console.warn('Could not reconcile orphaned booking:', error);
    } finally {
      orphanCleanupInFlight.delete(activeBooking.id);
    }
  }));
}

function setLocalSpaceStatus(spaceId, status) {
  const spaces = getSpaces().map((space) => (
    space.id === spaceId ? { ...space, status } : space
  ));
  saveJson(STORAGE_KEYS.spaces, spaces);
}

function removeLocalBookedDate(spaceId, date) {
  if (!date) return;
  const spaces = getSpaces().map((space) => (
    space.id === spaceId
      ? { ...space, bookedDates: (space.bookedDates || []).filter((bookedDate) => bookedDate !== date) }
      : space
  ));
  saveJson(STORAGE_KEYS.spaces, spaces);
}

async function releaseSpace(spaceId, date) {
  removeLocalBookedDate(spaceId, date);
  setLocalSpaceStatus(spaceId, 'available');
  if (window.CoworkingDB?.isReady?.() && window.CoworkingDB.updateSpaceStatus) {
    try {
      await window.CoworkingDB.updateSpaceStatus(spaceId, 'available');
    } catch (error) {
      console.warn('Could not mark space as available:', error);
    }
  }
}

function injectSiteFooter() {
  document.body.classList.add('site-layout');
  if (document.querySelector('.site-footer')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <a href="index.html" class="footer-brand">
              <span class="brand-mark">W</span>
              <span>WORKSPACE</span>
            </a>
            <p class="footer-about">Рабочие пространства для ваших идей и команд. Найдите место для продуктивной работы в Казахстане.</p>
          </div>
          <div class="footer-column">
            <h2>Навигация</h2>
            <div class="footer-links">
              <a href="index.html">Главная и каталог</a>
              <a href="bookings.html">Мои бронирования</a>
              <a href="profile.html">Личный кабинет</a>
              <a href="login.html">Войти или зарегистрироваться</a>
            </div>
          </div>
          <div class="footer-column">
            <h2>Мы в Казахстане</h2>
            <div class="footer-links">
              <span>Алматы</span>
              <span>Астана</span>
            </div>
          </div>
          <div class="footer-column">
            <h2>Контакты</h2>
            <div class="footer-links">
              <span>+7 000 000 0000</span>
              <a href="mailto:support@workspace.kz">support@workspace.kz</a>
              <span>Казахстан, Алматы, Назарбаева 103, 9 этаж</span>
              <span>Поддержка: ежедневно, 09:00–20:00</span>
            </div>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} WORKSPACE. Все права защищены.</span>
        </div>
      </div>
    </footer>
  `);
}

function formatCurrency(value) {
  return `${Number(value) || 0} ₸`;
}

function formatPrice(value) {
  return `${formatCurrency(value)}/час`;
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatCalendarDate(date) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toLocalDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function initializeBookingDatePicker(form, space) {
  const picker = form.querySelector('[data-booking-date-picker]');
  if (!picker) return;

  const dateInput = picker.querySelector('[name="date"]');
  const trigger = picker.querySelector('[data-booking-date-trigger]');
  const dateLabel = picker.querySelector('[data-booking-date-value]');
  const popover = picker.querySelector('[data-booking-date-popover]');
  const monthLabel = picker.querySelector('[data-booking-date-month]');
  const dayGrid = picker.querySelector('[data-booking-date-grid]');
  const previousButton = picker.querySelector('[data-booking-date-prev]');
  const nextButton = picker.querySelector('[data-booking-date-next]');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maximumDate = addDays(today, 14);
  const maximumMonth = new Date(maximumDate.getFullYear(), maximumDate.getMonth(), 1);
  const manuallyUnavailable = space.status === 'booked'
    && (!Array.isArray(space.bookedDates) || space.bookedDates.length === 0);
  const reservedDates = new Set([
    ...(Array.isArray(space.bookedDates) ? space.bookedDates : []),
    ...getActiveBookings()
      .filter((booking) => String(booking.workspaceId) === String(space.id))
      .map((booking) => booking.date)
  ]);
  let selectedDate = new Date(today);
  let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  dateInput.value = toLocalDateString(selectedDate);
  dateLabel.textContent = `Сегодня · ${formatCalendarDate(selectedDate)}`;

  const renderDays = () => {
    monthLabel.textContent = `${new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(visibleMonth)} ${visibleMonth.getFullYear()}`;
    previousButton.disabled = visibleMonth.getTime() <= new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    nextButton.disabled = visibleMonth.getTime() >= maximumMonth.getTime();

    const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    const offset = (new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay() + 6) % 7;
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
    const cells = weekdays.map((day) => `<span class="booking-calendar-weekday">${day}</span>`);

    for (let blank = 0; blank < offset; blank += 1) cells.push('<span class="booking-calendar-empty"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
      date.setHours(0, 0, 0, 0);
      const isToday = date.getTime() === today.getTime();
      const isSelected = date.getTime() === selectedDate.getTime();
      const dateString = toLocalDateString(date);
      const isOutOfRange = date < today || date > maximumDate;
      const isReserved = manuallyUnavailable || reservedDates.has(dateString);
      cells.push(`<button type="button" class="booking-calendar-day${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${isReserved ? ' is-reserved' : ''}${isOutOfRange ? ' is-out-of-range' : ''}" data-booking-date-day="${day}" aria-current="${isToday ? 'date' : 'false'}" aria-label="${dateString}${isReserved ? ', уже занято' : ''}" ${isOutOfRange || isReserved ? 'disabled' : ''}>${day}</button>`);
    }

    dayGrid.innerHTML = cells.join('');
    dayGrid.querySelectorAll('[data-booking-date-day]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedDate = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), Number(button.dataset.bookingDateDay));
        selectedDate.setHours(0, 0, 0, 0);
        dateInput.value = toLocalDateString(selectedDate);
        dateLabel.textContent = selectedDate.getTime() === today.getTime()
          ? `Сегодня · ${formatCalendarDate(selectedDate)}`
          : formatCalendarDate(selectedDate);
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      });
    });
  };

  trigger.addEventListener('click', () => {
    popover.hidden = !popover.hidden;
    trigger.setAttribute('aria-expanded', String(!popover.hidden));
    if (!popover.hidden) renderDays();
  });
  previousButton.addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    renderDays();
  });
  nextButton.addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    renderDays();
  });
  document.addEventListener('click', (event) => {
    if (!picker.contains(event.target)) {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  renderDays();
}

function format24HourTimeInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function formatCapacity(value) {
  const people = Number(value) || 0;
  return `${formatNumber(people)} ${people === 1 ? 'человека' : 'человек'}`;
}

function getBookingStatusLabel(status) {
  const labels = {
    pending: 'Ожидает подтверждения',
    confirmed: 'Подтверждена',
    completed: 'Завершена',
    expired: 'Истекла',
    cancelled: 'Отменена'
  };
  return labels[status] || 'Неизвестно';
}

function getGalleryImages(space = {}) {
  const primary = [space.image].filter(Boolean);
  const extra = Array.isArray(space.images) ? space.images.filter(Boolean) : [];
  const list = [...primary, ...extra].filter(Boolean);
  const slots = list.length ? list : [''];
  const totalSlots = 5;

  while (slots.length < totalSlots) {
    slots.push('');
  }

  return slots.slice(0, totalSlots);
}

function initializeFirebase() {
  if (!CoworkingDB.initialize(window.firebaseConfig)) return false;

  const page = document.body.dataset.page;
  const currentUser = getCurrentUser();

  if (page === 'detail') {
    const spaceId = new URLSearchParams(window.location.search).get('id');
    if (spaceId) {
      Promise.all([
        CoworkingDB.getSpaceById(spaceId),
        CoworkingDB.getSpacesPage({ sort: 'rating' }, null, PAGE_SIZE)
      ]).then(([space, page]) => {
        if (!space) return;
        const relatedCatalog = page.items.filter((item) => item.id !== space.id);
        saveJson(STORAGE_KEYS.spaces, [space, ...relatedCatalog, ...getSpaces().filter((item) => item.id !== space.id && !relatedCatalog.some((entry) => entry.id === item.id))]);
        renderDetail();
      }).catch((error) => console.warn('Could not load workspace:', error));
      CoworkingDB.listenToSpaceById(spaceId, (space) => {
        if (!space) return;
        saveJson(STORAGE_KEYS.spaces, [space, ...getSpaces().filter((item) => item.id !== space.id)]);
        renderDetail();
      });
      CoworkingDB.listenToReviewsBySpaceId(spaceId, (reviews) => {
        reviewStore.items = reviews;
        reviewStore.error = null;
        renderDetail();
      }, (error) => {
        console.error('Could not load workspace reviews:', error);
        reviewStore.error = 'Не удалось загрузить отзывы. Попробуйте обновить страницу.';
        renderDetail();
      });
    }
  }

  if (page === 'index') {
    CoworkingDB.listenToAllReviews((reviews) => {
      reviewStore.items = reviews;
      const currentSort = document.querySelector('[data-sort]')?.value || 'rating';
      if (currentSort === 'rating') {
        const visibleCount = catalogStore.spaces.length || PAGE_SIZE;
        catalogStore.fullSpaces = sortSpaces(catalogStore.fullSpaces, currentSort);
        catalogStore.spaces = catalogStore.fullSpaces.slice(0, visibleCount);
        catalogStore.hasMore = catalogStore.spaces.length < catalogStore.fullSpaces.length;
      } else {
        catalogStore.spaces = sortSpaces(catalogStore.spaces, currentSort);
      }
      renderCatalogList(catalogStore.spaces);
    }, (error) => {
      console.error('Could not load catalog ratings:', error);
    });
  }

  if (page === 'profile' && currentUser) {
    CoworkingDB.listenToReviewsByUserId(currentUser.id, (reviews) => {
      reviewStore.items = reviews;
      reviewStore.error = null;
      renderProfile();
    }, (error) => {
      console.error('Could not load user reviews:', error);
    });
  }

  if (page === 'admin' && currentUser?.role === 'admin') {
    CoworkingDB.listenToBookings((bookings) => {
      saveJson(STORAGE_KEYS.bookings, bookings);
      reconcileOrphanedActiveBookings();
      synchronizeExpiredBookings().catch((error) => console.warn('Expired booking sync warning:', error));
      renderAdmin();
    });
    CoworkingDB.listenToUsers((users) => {
      saveJson(STORAGE_KEYS.users, users);
      renderAdmin();
    });
    CoworkingDB.listenToAllReviews((reviews) => {
      reviewStore.items = reviews;
      renderAdmin();
    });
    CoworkingDB.listenToActiveBookings((bookings) => {
      saveJson(STORAGE_KEYS.activeBookings, bookings);
      reconcileOrphanedActiveBookings(bookings);
      renderAdmin();
    });
  } else if (page === 'bookings' && currentUser?.role === 'admin') {
    CoworkingDB.listenToBookings((bookings) => {
      saveJson(STORAGE_KEYS.bookings, bookings);
      reconcileOrphanedActiveBookings();
      synchronizeExpiredBookings().catch((error) => console.warn('Expired booking sync warning:', error));
      renderBookings();
    });
    CoworkingDB.listenToActiveBookings((bookings) => {
      saveJson(STORAGE_KEYS.activeBookings, bookings);
      reconcileOrphanedActiveBookings(bookings);
      renderBookings();
    });
  } else if (currentUser) {
    CoworkingDB.listenToUserBookings(currentUser.id, (bookings) => {
      saveJson(STORAGE_KEYS.bookings, bookings);
      reconcileOrphanedActiveBookings();
      synchronizeExpiredBookings().catch((error) => console.warn('Expired booking sync warning:', error));
      renderBookings();
      renderProfile();
    }, (error) => {
      console.error('Could not load user bookings:', error);
      showInlineMessage('Не удалось загрузить бронирования. Обновите страницу.', document.querySelector('[data-bookings]'), 'error');
    });
    CoworkingDB.listenToUserActiveBookings(currentUser.id, (bookings) => {
      saveJson(STORAGE_KEYS.activeBookings, bookings);
      reconcileOrphanedActiveBookings(bookings);
      renderBookings();
    }, (error) => {
      console.error('Could not load active bookings:', error);
    });
  }

  return true;
}

function setStoredReviews(reviews) {
  reviewStore.items = Array.isArray(reviews) ? reviews : [];
  if (!CoworkingDB.isReady()) {
    saveJson(STORAGE_KEYS.reviews, reviewStore.items);
  }
}

function getStoredReviews() {
  return reviewStore.items;
}

function getAverageRatingForSpace(spaceId) {
  const reviews = getStoredReviews().filter((review) => String(review.workspaceId) === String(spaceId));
  if (!reviews.length) return 0;
  const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
  return Number((total / reviews.length).toFixed(1));
}

function renderUserBadge() {
  const user = getCurrentUser();
  const badge = document.querySelector('[data-user-badge]');
  if (!badge) return;

  document.querySelectorAll('a[href="admin.html"]').forEach((link) => {
    link.hidden = !isAdmin();
  });

  if (!user) {
    badge.textContent = 'Войти';
    badge.href = 'login.html';
    badge.title = '';
    badge.dataset.action = 'login';
    badge.onclick = null;
    return;
  }

  badge.textContent = 'Выйти';
  badge.href = '#';
  badge.title = `${user.name} · ${user.role}`;
  badge.dataset.action = 'logout';
  badge.onclick = (event) => {
    event.preventDefault();
    logoutCurrentUser();
  };
}

function normalizeSpaceGallery(space = {}) {
  const actualImages = Array.isArray(space.images) && space.images.length
    ? space.images.filter(Boolean)
    : [space.image].filter(Boolean);

  const hasCustomGallery = space.galleryMode === 'custom' || (Array.isArray(space.images) && space.images.length > 0);
  const baseImages = actualImages.length ? actualImages : [''];

  if (hasCustomGallery) {
    return baseImages;
  }

  const paddedImages = [...baseImages];
  while (paddedImages.length < 5) {
    paddedImages.push('');
  }

  return paddedImages.slice(0, 5);
}

function getRealGalleryImages(space) {
  return normalizeSpaceGallery(space).filter(Boolean);
}

function updateGalleryButtonState(spaceId, currentIndex) {
  const space = getSpaces().find((item) => item.id === spaceId);
  const images = getRealGalleryImages(space);
  const prevButton = document.querySelector(`[data-gallery-prev="${spaceId}"]`);
  const nextButton = document.querySelector(`[data-gallery-next="${spaceId}"]`);

  if (prevButton) {
    prevButton.style.visibility = currentIndex <= 0 || images.length <= 1 ? 'hidden' : 'visible';
  }

  if (nextButton) {
    nextButton.style.visibility = currentIndex >= images.length - 1 || images.length <= 1 ? 'hidden' : 'visible';
  }
}

function buildSpaceCard(space) {
  const rating = getAverageRatingForSpace(space.id);
  const features = Array.isArray(space.features) ? space.features : [];
  const images = normalizeSpaceGallery(space);
  const galleryIndex = 0;
  const realImages = getRealGalleryImages(space);

  return `
    <article class="space-card" data-space-card="${space.id}">
      <div class="thumb" data-space-thumb="${space.id}" data-gallery-index="${galleryIndex}" style="background: ${images[0] ? `url('${images[0]}') center/cover no-repeat` : 'linear-gradient(135deg, #e2e8f0, #cbd5e1)'}; position: relative; overflow: hidden;">
        <button type="button" data-gallery-prev="${space.id}" aria-label="Предыдущее фото" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border: 1px solid rgba(255,255,255,0.7); border-radius: 50%; background: rgba(15, 23, 42, 0.18); color: rgba(255,255,255,0.95); font-size: 24px; line-height: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0.95; visibility: ${realImages.length > 1 ? 'hidden' : 'hidden'}; z-index: 3; pointer-events: auto;"><</button>
        <button type="button" data-gallery-next="${space.id}" aria-label="Следующее фото" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border: 1px solid rgba(255,255,255,0.7); border-radius: 50%; background: rgba(15, 23, 42, 0.18); color: rgba(255,255,255,0.95); font-size: 24px; line-height: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0.95; visibility: ${realImages.length > 1 ? 'visible' : 'hidden'}; z-index: 3; pointer-events: auto;">></button>
        <span class="badge ${isSpaceOccupied(space) ? 'warning' : ''}">${isSpaceOccupied(space) ? 'Занято' : 'Доступно'}</span>
      </div>
      <div class="content">
        <div class="meta-row">
          <span class="inline-tag">${space.category}</span>
          <span class="muted">${rating ? `★ ${rating.toFixed(1)}` : 'Нет оценок'}</span>
        </div>
        <h3>${space.title}</h3>
        <p>${space.city || ''} · до ${formatCapacity(space.capacity)}</p>
        <div class="feature-list">
          ${features.slice(0, 3).map((feature) => `<span class="feature-tag">${feature}</span>`).join('')}
        </div>
        <div class="price-row">
          <div class="price">${formatPrice(space.pricePerHour)}</div>
          <div class="card-actions">
            <a class="btn primary compact" href="detail.html?id=${space.id}">Подробнее</a>
            ${isAdmin() ? `<button class="btn secondary compact" type="button" data-edit-space="${space.id}" title="Редактировать карточку">Изменить</button>` : ''}
          </div>
        </div>
      </div>
    </article>
  `;
}

function sortSpaces(spaces, sortValue) {
  return [...spaces].sort((a, b) => {
    switch (sortValue) {
      case 'price-low':
        return Number(a.pricePerHour) - Number(b.pricePerHour);
      case 'price-high':
        return Number(b.pricePerHour) - Number(a.pricePerHour);
      case 'date':
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      default:
        return getAverageRatingForSpace(b.id) - getAverageRatingForSpace(a.id);
    }
  });
}

function buildSpaceSearchText(space = {}) {
  return [space.title, space.description, space.city, space.country || 'Казахстан', space.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getFilteredSortedSpaces(spaces = getSpaces(), filters = getCatalogFilters()) {
  const searchableSpaces = spaces.map((space) => ({
    ...space,
    searchText: buildSpaceSearchText(space)
  }));
  const term = (filters.searchText || '').trim().toLowerCase();
  const selectedCategory = filters.category || 'all';

  const filtered = searchableSpaces.filter((space) => {
    const matchesSearch = !term || (space.searchText || '').includes(term);
    const matchesCategory = selectedCategory === 'all' || space.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return sortSpaces(filtered, filters.sort || 'rating');
}

function renderCatalogList(spaces) {
  const catalogRoot = document.querySelector('[data-catalog]');
  if (!catalogRoot) return;

  const showMoreBtn = document.querySelector('[data-show-more]');
  if (showMoreBtn) {
    showMoreBtn.disabled = catalogStore.loading || !catalogStore.hasMore;
    showMoreBtn.textContent = catalogStore.loading
      ? 'Загрузка…'
      : catalogStore.hasMore ? 'Показать ещё' : 'Показано всё';
  }

  catalogRoot.innerHTML = spaces.length
    ? spaces.map(buildSpaceCard).join('')
    : '<div class="empty-state">Ничего не найдено по вашему запросу.</div>';
  bindGalleryControls();
}

function getCatalogFilters() {
  return {
    searchText: document.querySelector('[data-search]')?.value.trim() || '',
    category: document.body.dataset.activeCategory || 'all',
    sort: document.querySelector('[data-sort]')?.value || 'rating'
  };
}

function renderCatalog() {
  const filters = getCatalogFilters();
  const queryKey = JSON.stringify(filters);
  const catalogRoot = document.querySelector('[data-catalog]');
  if (!catalogRoot) return;

  if (!CoworkingDB.isReady()) {
    catalogStore.fullSpaces = getFilteredSortedSpaces();
    catalogStore.spaces = catalogStore.fullSpaces.slice(0, PAGE_SIZE);
    catalogStore.cursor = catalogStore.spaces.length;
    catalogStore.hasMore = catalogStore.spaces.length < catalogStore.fullSpaces.length;
    renderCatalogList(catalogStore.spaces);
    return;
  }

  if (catalogStore.queryKey === queryKey) return;
  catalogStore.unsubscribe?.();
  catalogStore.unsubscribe = null;
  catalogStore.queryKey = queryKey;
  catalogStore.spaces = [];
  catalogStore.fullSpaces = [];
  catalogStore.cursor = null;
  catalogStore.hasMore = false;
  catalogStore.loading = true;
  catalogRoot.innerHTML = '<div class="empty-state">Загрузка…</div>';
  renderCatalogList(catalogStore.spaces);

  if (filters.sort === 'rating') {
    catalogStore.unsubscribe = CoworkingDB.listenToAllSpaces((spaces) => {
      if (catalogStore.queryKey !== queryKey) return;
      catalogStore.fullSpaces = getFilteredSortedSpaces(spaces, filters);
      catalogStore.spaces = catalogStore.fullSpaces.slice(0, Math.max(PAGE_SIZE, catalogStore.spaces.length));
      catalogStore.cursor = catalogStore.spaces.length;
      catalogStore.loading = false;
      catalogStore.hasMore = catalogStore.spaces.length < catalogStore.fullSpaces.length;
      saveJson(STORAGE_KEYS.spaces, spaces);
      renderCatalogList(catalogStore.spaces);
      renderHomeStats();
    }, (error) => {
      if (catalogStore.queryKey !== queryKey) return;
      console.error('Could not load popular catalog:', error);
      catalogStore.loading = false;
      catalogStore.queryKey = '';
      catalogRoot.innerHTML = '<div class="empty-state">Не удалось загрузить каталог.</div>';
    });
    return;
  }

  catalogStore.unsubscribe = CoworkingDB.listenToSpaces((page) => {
    const previousItems = catalogStore.spaces;
    const sameFirstPage = page.items.every((space, index) => space.id === previousItems[index]?.id);
    const keepLoadedPages = page.items.length === PAGE_SIZE
      && sameFirstPage
      && previousItems.length > page.items.length;
    catalogStore.spaces = keepLoadedPages
      ? [...page.items, ...previousItems.slice(page.items.length)]
      : page.items;
    if (!keepLoadedPages) {
      catalogStore.cursor = page.cursor;
      catalogStore.hasMore = page.hasMore;
    }
    catalogStore.loading = false;
    const cached = getSpaces();
    saveJson(STORAGE_KEYS.spaces, [
      ...catalogStore.spaces,
      ...cached.filter((space) => !catalogStore.spaces.some((item) => item.id === space.id))
    ]);
    renderCatalogList(catalogStore.spaces);
    renderHomeStats();
  }, filters, PAGE_SIZE, (error) => {
    console.error('Could not load catalog page:', error);
    catalogStore.loading = false;
    catalogStore.queryKey = '';
    catalogRoot.innerHTML = '<div class="empty-state">Не удалось загрузить каталог.</div>';
  });
}

async function loadMoreCatalog() {
  if (catalogStore.loading || !catalogStore.hasMore) return;

  if (catalogStore.fullSpaces.length) {
    catalogStore.loading = true;
    const nextCount = Math.min(catalogStore.fullSpaces.length, catalogStore.spaces.length + PAGE_SIZE);
    catalogStore.spaces = catalogStore.fullSpaces.slice(0, nextCount);
    catalogStore.cursor = nextCount;
    catalogStore.hasMore = nextCount < catalogStore.fullSpaces.length;
    catalogStore.loading = false;
    renderCatalogList(catalogStore.spaces);
    return;
  }

  if (!catalogStore.cursor) return;
  catalogStore.loading = true;
  renderCatalogList(catalogStore.spaces);
  try {
    const page = await CoworkingDB.getSpacesPage(getCatalogFilters(), catalogStore.cursor, PAGE_SIZE);
    const knownIds = new Set(catalogStore.spaces.map((space) => space.id));
    catalogStore.spaces = [...catalogStore.spaces, ...page.items.filter((space) => !knownIds.has(space.id))];
    catalogStore.cursor = page.cursor;
    catalogStore.hasMore = page.hasMore;
    const cached = getSpaces();
    const merged = [...catalogStore.spaces, ...cached.filter((space) => !catalogStore.spaces.some((item) => item.id === space.id))];
    saveJson(STORAGE_KEYS.spaces, merged);
  } catch (error) {
    console.error('Could not load next catalog page:', error);
    showInlineMessage(`Не удалось загрузить следующую страницу: ${error.message}`, document.querySelector('main'), 'error');
  } finally {
    catalogStore.loading = false;
    renderCatalogList(catalogStore.spaces);
  }
}

function bindGalleryControls() {
  document.querySelectorAll('[data-gallery-next]').forEach((button) => {
    button.onclick = () => {
      const cardId = button.dataset.galleryNext;
      const thumb = document.querySelector(`[data-space-thumb="${cardId}"]`);
      if (!thumb) return;

      const space = getSpaces().find((item) => item.id === cardId);
      const images = getRealGalleryImages(space);
      if (!images.length) return;

      const currentIndex = Number(thumb.dataset.galleryIndex || 0);
      const nextIndex = Math.min(currentIndex + 1, images.length - 1);
      const nextImage = images[nextIndex];

      thumb.dataset.galleryIndex = String(nextIndex);
      thumb.style.background = nextImage
        ? `url('${nextImage}') center/cover no-repeat`
        : 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';

      updateGalleryButtonState(cardId, nextIndex);
    };
  });

  document.querySelectorAll('[data-gallery-prev]').forEach((button) => {
    button.onclick = () => {
      const cardId = button.dataset.galleryPrev;
      const thumb = document.querySelector(`[data-space-thumb="${cardId}"]`);
      if (!thumb) return;

      const space = getSpaces().find((item) => item.id === cardId);
      const images = getRealGalleryImages(space);
      if (!images.length) return;

      const currentIndex = Number(thumb.dataset.galleryIndex || 0);
      const nextIndex = Math.max(currentIndex - 1, 0);
      const nextImage = images[nextIndex];

      thumb.dataset.galleryIndex = String(nextIndex);
      thumb.style.background = nextImage
        ? `url('${nextImage}') center/cover no-repeat`
        : 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';

      updateGalleryButtonState(cardId, nextIndex);
    };
  });
}

function bindCatalogControls() {
  const searchInput = document.querySelector('[data-search]');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(renderCatalog, 300);
    });
  }

  const sortSelect = document.querySelector('[data-sort]');
  if (sortSelect) {
    sortSelect.addEventListener('change', renderCatalog);
  }

  document.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      document.body.dataset.activeCategory = button.dataset.category;
      document.querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('active', item === button));
      renderCatalog();
    });
  });

  const showMoreBtn = document.querySelector('[data-show-more]');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', loadMoreCatalog);
  }

  bindGalleryControls();
}

function getRelatedSpaces(space, spaces) {
  if (!space) return [];
  return spaces
    .filter((item) => item.id !== space.id && item.category === space.category)
    .sort((a, b) => getAverageRatingForSpace(b.id) - getAverageRatingForSpace(a.id));
}

function renderRelatedSpaces(space) {
  const relatedRoot = document.querySelector('[data-related]');
  const showMoreButton = document.querySelector('[data-show-more-related]');
  if (!relatedRoot) return;

  const spaces = getSpaces();
  const related = getRelatedSpaces(space, spaces);
  const currentVisible = Number(showMoreButton?.dataset.visible || String(DETAIL_RELATED_PAGE_SIZE));
  const visibleCount = Math.min(currentVisible, related.length);
  const visibleItems = related.slice(0, visibleCount);

  relatedRoot.innerHTML = visibleItems.length
    ? visibleItems.map(buildSpaceCard).join('')
    : '<div class="empty-state">Похожие варианты не найдены.</div>';

  if (showMoreButton) {
    showMoreButton.disabled = visibleCount >= related.length;
    showMoreButton.textContent = visibleCount >= related.length ? 'Показано всё' : 'Показать ещё';
    showMoreButton.dataset.visible = String(visibleCount);
    showMoreButton.onclick = () => {
      const nextVisible = Math.min(related.length, visibleCount + DETAIL_RELATED_PAGE_SIZE);
      showMoreButton.dataset.visible = String(nextVisible);
      renderRelatedSpaces(space);
    };
  }
}

function getReviewStats(spaceId) {
  const reviews = getStoredReviews().filter((review) => String(review.workspaceId) === String(spaceId));
  if (!reviews.length) {
    return { average: 0, count: 0, reviews };
  }

  const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
  return {
    average: Number((total / reviews.length).toFixed(1)),
    count: reviews.length,
    reviews: [...reviews].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  };
}

function renderDetail() {
  const root = document.querySelector('[data-detail]');
  if (!root) return;

  const urlParams = new URLSearchParams(window.location.search);
  const spaceId = urlParams.get('id');
  const spaces = getSpaces();
  const space = spaces.find((item) => item.id === spaceId) || spaces[0];
  if (!space) return;

  const isBooked = isSpaceOccupied(space);
  const features = Array.isArray(space.features) ? space.features : [];
  const statusLabel = isBooked ? 'Занято' : 'Доступно';
  const reviewStats = getReviewStats(space.id);
  const reviewSummary = reviewStore.error
    ? `<div class="review-summary">${reviewStore.error}</div>`
    : reviewStats.count
      ? `<div class="review-summary"><strong>Средняя оценка:</strong> ${reviewStats.average}/5 · ${reviewStats.count} отзыв${reviewStats.count === 1 ? '' : 'а'}</div>`
      : '<div class="review-summary"><strong>Средняя оценка:</strong> ещё нет оценок</div>';

  const reviewList = reviewStore.error
    ? `<div class="empty-state">${reviewStore.error}</div>`
    : reviewStats.reviews.length
      ? `
      <div class="review-list" data-reviews>
        ${reviewStats.reviews.slice(0, 5).map((review) => `
          <article class="history-item">
            <h4>${escapeHtml(review.userName || 'Пользователь')}</h4>
            <p><strong>Оценка:</strong> ${Number(review.rating || 0)}/5</p>
            ${review.comment ? `<p>${escapeHtml(review.comment)}</p>` : '<p class="muted">Только оценка</p>'}
            <small class="muted">${formatDate(review.createdAt)}</small>
          </article>
        `).join('')}
      </div>
    `
      : '<div class="empty-state">Пока нет отзывов. Будьте первым.</div>';

  const galleryImages = normalizeSpaceGallery(space);
  const selectedImage = galleryImages[0] || '';

  root.innerHTML = `
    <div class="detail-layout">
      <div>
        <div class="detail-hero" style="background: ${selectedImage ? `url('${selectedImage}') center/cover no-repeat` : 'linear-gradient(135deg, #e2e8f0, #cbd5e1)'}; position: relative; overflow: hidden;">
          <button type="button" data-detail-gallery-prev="${space.id}" aria-label="Предыдущее фото" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border: 1px solid rgba(255,255,255,0.65); border-radius: 50%; background: rgba(15, 23, 42, 0.18); color: rgba(255,255,255,0.95); font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 3; pointer-events: auto; ${!selectedImage ? 'visibility: hidden;' : ''}"><</button>
          <button type="button" data-detail-gallery-next="${space.id}" aria-label="Следующее фото" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border: 1px solid rgba(255,255,255,0.65); border-radius: 50%; background: rgba(15, 23, 42, 0.18); color: rgba(255,255,255,0.95); font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 3; pointer-events: auto;">></button>
        </div>
        <div class="detail-content">
          <div class="detail-header">
            <div>
              <div class="inline-tag">${space.category}</div>
              <h1>${space.title}</h1>
            </div>
            ${isAdmin() ? `<button class="btn secondary compact" type="button" data-edit-space="${space.id}" style="align-self: flex-start; margin-top: 0.5rem;">Редактировать помещение</button>` : ''}
          </div>
          <p>${space.description}</p>
          <div class="feature-list">
            ${features.map((feature) => `<span class="feature-tag">${feature}</span>`).join('')}
          </div>
          <p class="muted">Вместимость: до ${formatCapacity(space.capacity)}</p>
          <p class="muted"><strong>Расположение:</strong> ${space.country || 'Казахстан'}, ${space.city} / ${space.address}</p>
          ${reviewSummary}
          <div class="section-heading" style="margin-top: 1.4rem; margin-bottom: 0.8rem;">
            <h3>Отзывы</h3>
          </div>
          ${reviewList}
        </div>
      </div>
      <aside class="booking-panel">
        <div class="booking-status ${isBooked ? 'is-booked' : ''}">
          <span class="detail-status-dot"></span>
          <span><small>Статус помещения</small><strong>${statusLabel}</strong></span>
        </div>
        <div class="price">${formatPrice(space.pricePerHour)}</div>
        <form data-booking-form>
          <div class="form-grid">
            <div class="booking-date-field">
              <span class="muted">Дата</span>
              <div class="booking-date-picker" data-booking-date-picker>
                <button class="input booking-date-trigger" type="button" data-booking-date-trigger aria-haspopup="dialog" aria-expanded="false">
                  <span data-booking-date-value></span><span aria-hidden="true">▾</span>
                </button>
                <div class="booking-date-popover" data-booking-date-popover role="dialog" aria-label="Выбор дня и месяца" hidden>
                  <div class="booking-calendar-header">
                    <button class="booking-calendar-nav" type="button" data-booking-date-prev aria-label="Предыдущий месяц">‹</button>
                    <strong data-booking-date-month></strong>
                    <button class="booking-calendar-nav" type="button" data-booking-date-next aria-label="Следующий месяц">›</button>
                  </div>
                  <div class="booking-calendar-grid" data-booking-date-grid></div>
                  <div class="booking-calendar-legend" aria-label="Обозначения календаря">
                    <span class="booking-calendar-legend-swatch is-reserved" aria-hidden="true"></span><small>Занято</small>
                    <span class="booking-calendar-legend-swatch is-unavailable" aria-hidden="true"></span><small>Недоступно</small>
                  </div>
                </div>
                <input type="hidden" name="date" required>
              </div>
            </div>
            <label>
              <span class="muted">Время</span>
              <input class="input" type="text" name="time" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="чч:мм (24 часа)" required>
            </label>
            <label>
              <span class="muted">Продолжительность</span>
              <select class="control-select" name="duration">
                <option value="1">1 час</option>
                <option value="2">2 часа</option>
                <option value="3">3 часа</option>
                <option value="4">4 часа</option>
                <option value="5">5 часов</option>
                <option value="6">6 часов</option>
              </select>
            </label>
            <label>
              <span class="muted">Количество человек</span>
              <input class="input" type="number" name="seats" min="1" max="${Math.max(1, Number(space.capacity) || 1)}" step="1" value="1" required>
            </label>
          </div>
          <div class="summary-box">
            <strong>Итог: <span data-total>${formatPrice(space.pricePerHour)}</span></strong>
            <span class="muted">Сумма считается по количеству человек и длительности брони.</span>
          </div>
          <button class="btn primary" style="width: 100%; margin-top: 1rem;" type="submit">Перейти к оплате</button>
        </form>

        <div class="modal-overlay payment-modal" data-payment-modal hidden>
          <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
            <div class="modal-header">
              <h3 id="payment-modal-title">Оплата бронирования</h3>
              <button class="modal-close-btn" type="button" data-payment-close aria-label="Закрыть">&times;</button>
            </div>
            <div class="modal-body">
              <p class="muted">Демонстрационная оплата. Не вводите данные настоящей карты — они не сохраняются.</p>
              <form class="form-grid" data-payment-form>
                <label>
                  <span class="muted">Фамилия и имя владельца карты</span>
                  <input class="input" type="text" name="cardholder" autocomplete="cc-name" maxlength="80" placeholder="Иванов Иван" required>
                </label>
                <label>
                  <span class="muted">Номер карты</span>
                  <input class="input" type="text" name="cardNumber" inputmode="numeric" autocomplete="cc-number" maxlength="19" pattern="[0-9 ]{16,19}" placeholder="0000 0000 0000 0000" required>
                </label>
                <div class="form-grid payment-card-details">
                  <label>
                    <span class="muted">Срок действия</span>
                    <input class="input" type="text" name="cardExpiry" inputmode="numeric" autocomplete="cc-exp" maxlength="5" pattern="(0[1-9]|1[0-2])/[0-9]{2}" placeholder="ММ/ГГ" required>
                  </label>
                  <label>
                    <span class="muted">CVC</span>
                    <input class="input" type="password" name="cardCvc" inputmode="numeric" autocomplete="cc-csc" minlength="3" maxlength="3" pattern="[0-9]{3}" required>
                  </label>
                </div>
                <button class="btn primary" type="submit">Оплатить и подтвердить бронь</button>
              </form>
            </div>
          </div>
        </div>

        <form data-review-form style="margin-top: 1.2rem;">
          <div class="section-heading" style="margin-bottom: 0.8rem;">
            <h3>Оценка и отзыв</h3>
          </div>
          <div class="form-grid" style="gap: 0.8rem;">
            <label>
              <span class="muted">Ваша оценка</span>
              <select class="control-select" name="rating" data-rating-picker>
                <option value="5">5 — отлично</option>
                <option value="4">4 — хорошо</option>
                <option value="3">3 — нормально</option>
                <option value="2">2 — плохо</option>
                <option value="1">1 — очень плохо</option>
              </select>
            </label>
            <label>
              <span class="muted">Комментарий (необязательно)</span>
              <textarea class="input" name="comment" rows="3" placeholder="Напишите отзыв о пространстве..."></textarea>
            </label>
            <button class="btn secondary" type="submit">Оставить отзыв</button>
            <p class="inline-message" data-inline-message role="status" aria-live="polite" hidden></p>
          </div>
        </form>
      </aside>
    </div>
  `;

  const detailHero = document.querySelector('.detail-hero');
  if (detailHero) {
    const images = getRealGalleryImages(space);
    detailHero.dataset.galleryIndex = '0';
    detailHero.dataset.galleryImages = JSON.stringify(images);

    const nextBtn = document.querySelector('[data-detail-gallery-next]');
    const prevBtn = document.querySelector('[data-detail-gallery-prev]');

    if (prevBtn) prevBtn.style.visibility = images.length > 1 ? 'hidden' : 'hidden';
    if (nextBtn) nextBtn.style.visibility = images.length > 1 ? 'visible' : 'hidden';

    nextBtn?.addEventListener('click', () => {
      const currentImages = JSON.parse(detailHero.dataset.galleryImages || '[]');
      const currentIndex = Number(detailHero.dataset.galleryIndex || 0);
      const nextIndex = Math.min(currentIndex + 1, currentImages.length - 1);
      const nextImage = currentImages[nextIndex];
      detailHero.dataset.galleryIndex = String(nextIndex);
      detailHero.style.background = nextImage
        ? `url('${nextImage}') center/cover no-repeat`
        : 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';
      if (prevBtn) prevBtn.style.visibility = nextIndex <= 0 ? 'hidden' : 'visible';
      if (nextBtn) nextBtn.style.visibility = nextIndex >= currentImages.length - 1 ? 'hidden' : 'visible';
    });

    prevBtn?.addEventListener('click', () => {
      const currentImages = JSON.parse(detailHero.dataset.galleryImages || '[]');
      const currentIndex = Number(detailHero.dataset.galleryIndex || 0);
      const nextIndex = Math.max(currentIndex - 1, 0);
      const nextImage = currentImages[nextIndex];
      detailHero.dataset.galleryIndex = String(nextIndex);
      detailHero.style.background = nextImage
        ? `url('${nextImage}') center/cover no-repeat`
        : 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';
      if (prevBtn) prevBtn.style.visibility = nextIndex <= 0 ? 'hidden' : 'visible';
      if (nextBtn) nextBtn.style.visibility = nextIndex >= currentImages.length - 1 ? 'hidden' : 'visible';
    });
  }

  const totalEl = document.querySelector('[data-total]');
  const form = document.querySelector('[data-booking-form]');
  const paymentModal = document.querySelector('[data-payment-modal]');
  const paymentForm = document.querySelector('[data-payment-form]');
  const reviewForm = document.querySelector('[data-review-form]');
  let pendingBookingDetails = null;
  let previousBodyOverflow = '';
  if (form && totalEl) {
    initializeBookingDatePicker(form, space);
    form.elements.time.addEventListener('input', (event) => {
      event.target.value = format24HourTimeInput(event.target.value);
    });

    form.addEventListener('input', () => {
      const duration = Number(form.querySelector('[name="duration"]').value || 1);
      const seatsInput = form.querySelector('[name="seats"]');
      const capacity = Math.max(1, Number(space.capacity) || 1);
      if (Number(seatsInput.value) > capacity) seatsInput.value = String(capacity);
      const seats = Number(seatsInput.value || 1);
      totalEl.textContent = formatPrice(space.pricePerHour * duration * seats);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const date = data.get('date');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const maximumDate = addDays(today, 14);
      const dateParts = String(date || '').split('-').map(Number);
      const selectedDate = dateParts.length === 3
        ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
        : null;
      if (!date) {
        showInlineMessage('Выберите дату бронирования.', form, 'error');
        return;
      }
      if (!selectedDate || Number.isNaN(selectedDate.getTime())
        || toLocalDateString(selectedDate) !== date
        || selectedDate < today || selectedDate > maximumDate) {
        showInlineMessage('Можно выбрать дату не раньше сегодня и не более чем на 14 дней вперёд.', form, 'error');
        return;
      }
      const isDateReserved = (space.status === 'booked'
        && (!Array.isArray(space.bookedDates) || space.bookedDates.length === 0))
        || (space.bookedDates || []).includes(date)
        || getActiveBookings().some((booking) => (
          String(booking.workspaceId) === String(space.id) && booking.date === date
        ));
      if (isDateReserved) {
        showInlineMessage('На эту дату уже есть бронирование. Выберите другой день.', form, 'error');
        return;
      }
      const time = String(data.get('time') || '').trim();
      const duration = Number(data.get('duration')) || 1;
      const seats = Number(data.get('seats'));
      const capacity = Math.max(1, Number(space.capacity) || 1);
      if (!Number.isInteger(seats) || seats < 1 || seats > capacity) {
        showInlineMessage(`Количество человек не может превышать вместимость помещения: ${capacity}.`, form, 'error');
        return;
      }
      if (!Number.isInteger(duration) || duration < 1 || duration > 6) {
        showInlineMessage('Максимальная продолжительность бронирования — 6 часов.', form, 'error');
        return;
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        showInlineMessage('Введите время в формате чч:мм, например 14:30.', form, 'error');
        return;
      }
      const [startHour, startMinute] = time.split(':').map(Number);
      const endMinutes = startHour * 60 + startMinute + duration * 60;
      if (endMinutes > 24 * 60) {
        showInlineMessage('Выберите время, чтобы бронирование закончилось до полуночи.', form, 'error');
        return;
      }
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      const currentUser = getCurrentUser();
      if (!currentUser) {
        window.location.href = 'login.html';
        return;
      }

      pendingBookingDetails = { date, time, duration, seats, endTime, currentUser };
      previousBodyOverflow = document.body.style.overflow;
      paymentModal.hidden = false;
      document.body.style.overflow = 'hidden';
      paymentForm.querySelector('[name="cardFirstName"]')?.focus();
    });
  }

  if (paymentForm && paymentModal) {
    const cardNumberInput = paymentForm.querySelector('[name="cardNumber"]');
    const cardExpiryInput = paymentForm.querySelector('[name="cardExpiry"]');
    const cardCvcInput = paymentForm.querySelector('[name="cardCvc"]');
    const closePaymentModal = () => {
      paymentModal.hidden = true;
      document.body.style.overflow = previousBodyOverflow;
      pendingBookingDetails = null;
      paymentForm.reset();
    };

    cardNumberInput?.addEventListener('input', () => {
      const cursor = cardNumberInput.selectionStart || 0;
      const digitsBeforeCursor = cardNumberInput.value.slice(0, cursor).replace(/\D/g, '').length;
      const digits = cardNumberInput.value.replace(/\D/g, '').slice(0, 16);
      const formatted = (digits.match(/.{1,4}/g) || []).join(' ');
      cardNumberInput.value = formatted;
      let nextCursor = 0;
      let digitsSeen = 0;
      while (nextCursor < formatted.length && digitsSeen < digitsBeforeCursor) {
        if (/\d/.test(formatted[nextCursor])) digitsSeen += 1;
        nextCursor += 1;
      }
      if (formatted[nextCursor] === ' ' && digitsBeforeCursor > 0) nextCursor += 1;
      cardNumberInput.setSelectionRange(nextCursor, nextCursor);
    });

    cardExpiryInput?.addEventListener('input', () => {
      const cursor = cardExpiryInput.selectionStart || 0;
      const digitsBeforeCursor = cardExpiryInput.value.slice(0, cursor).replace(/\D/g, '').length;
      const digits = cardExpiryInput.value.replace(/\D/g, '').slice(0, 4);
      const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
      cardExpiryInput.value = formatted;
      let nextCursor = 0;
      let digitsSeen = 0;
      while (nextCursor < formatted.length && digitsSeen < digitsBeforeCursor) {
        if (/\d/.test(formatted[nextCursor])) digitsSeen += 1;
        nextCursor += 1;
      }
      if (formatted[nextCursor] === '/' && digitsBeforeCursor >= 2) nextCursor += 1;
      cardExpiryInput.setSelectionRange(nextCursor, nextCursor);
    });

    cardCvcInput?.addEventListener('input', () => {
      cardCvcInput.value = cardCvcInput.value.replace(/\D/g, '').slice(0, 3);
    });

    paymentModal.querySelectorAll('[data-payment-close]').forEach((button) => {
      button.addEventListener('click', closePaymentModal);
    });
    paymentModal.addEventListener('click', (event) => {
      if (event.target === paymentModal) closePaymentModal();
    });
    paymentModal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePaymentModal();
    });

    paymentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!pendingBookingDetails) return;

      const data = new FormData(paymentForm);
      const cardholder = String(data.get('cardholder') || '').trim();
      const cardNumber = String(data.get('cardNumber') || '').replace(/\D/g, '');
      const cardExpiry = String(data.get('cardExpiry') || '').trim();
      const cardCvc = String(data.get('cardCvc') || '').trim();
      const expiryMatch = cardExpiry.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
      if (!cardholder || cardNumber.length !== 16
        || !expiryMatch || !/^\d{3}$/.test(cardCvc)) {
        showInlineMessage('Проверьте номер карты, срок действия и CVC.', paymentForm, 'error');
        return;
      }
      const expiryMonth = Number(expiryMatch[1]);
      const expiryYear = 2000 + Number(expiryMatch[2]);
      const currentDate = new Date();
      if (expiryYear < currentDate.getFullYear()
        || (expiryYear === currentDate.getFullYear() && expiryMonth < currentDate.getMonth() + 1)) {
        showInlineMessage('Срок действия карты уже истёк.', paymentForm, 'error');
        return;
      }

      const { date, time, duration, seats, endTime, currentUser } = pendingBookingDetails;
      const booking = {
        id: `booking_${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name || '',
        userEmail: String(window.firebase?.auth?.().currentUser?.email || currentUser.email || '').trim(),
        workspaceId: space.id,
        workspaceTitle: space.title,
        city: space.city || '',
        address: space.address || 'Адрес не указан',
        date,
        timeSlot: `${time} - ${endTime}`,
        duration,
        status: 'confirmed',
        paymentStatus: 'paid',
        paymentMethod: 'fake-card',
        cardLast4: cardNumber.slice(-4),
        paidAt: new Date().toISOString(),
        amount: space.pricePerHour * duration * seats,
        seats,
        createdAt: new Date().toISOString()
      };
      const submitButton = paymentForm.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        if (CoworkingDB.isReady()) {
          await CoworkingDB.createBooking(booking);
        } else {
          const bookings = getBookings();
          bookings.unshift(booking);
          saveJson(STORAGE_KEYS.bookings, bookings);
          saveJson(STORAGE_KEYS.activeBookings, [booking, ...getActiveBookings()]);
          const spaces = getSpaces().map((item) => (
            item.id === space.id
              ? {
                ...item,
                status: 'booked',
                lastBookingId: booking.id,
                bookedDates: [...new Set([...(item.bookedDates || []), date])]
              }
              : item
          ));
          saveJson(STORAGE_KEYS.spaces, spaces);
        }
        window.location.href = 'bookings.html';
      } catch (error) {
        submitButton.disabled = false;
        const message = error.code === 'permission-denied'
          ? 'Firebase отклонил запись. Проверьте совпадение email аккаунта и опубликованных правил Firestore (firebase deploy --only firestore:rules).'
          : error.message;
        showInlineMessage(`Не удалось оформить оплату и бронь: ${message}`, paymentForm, 'error');
      }
    });
  }

  if (reviewForm) {
    reviewForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentUser = getCurrentUser();
      const formData = new FormData(reviewForm);
      const rating = Number(formData.get('rating')) || 5;
      const comment = String(formData.get('comment') || '').trim();
      let authUid;
      try {
        authUid = CoworkingDB.isReady()
          ? await CoworkingDB.getAuthenticatedUserId()
          : currentUser?.id || null;
      } catch (error) {
        showInlineMessage(`Не удалось проверить вход в аккаунт: ${error.message}`, reviewForm, 'error');
        return;
      }

      if (!currentUser || !authUid) {
        window.location.href = 'login.html';
        return;
      }

      const review = {
        id: `review_${Date.now()}`,
        userId: authUid,
        userName: currentUser.name || 'Пользователь',
        workspaceId: space.id,
        rating,
        ...(comment ? { comment } : {}),
        createdAt: new Date().toISOString()
      };

      if (CoworkingDB.isReady()) {
        try {
          await CoworkingDB.createReview(review);
          reviewStore.items = [review, ...reviewStore.items.filter((item) => item.id !== review.id)];
          try {
            reviewStore.items = await CoworkingDB.getReviewsBySpaceId(space.id);
          } catch (refreshError) {
            console.warn('Review saved, but ratings could not be refreshed:', refreshError);
          }
          reviewStore.error = null;
          reviewForm.reset();
          renderDetail();
          showInlineMessage('Отзыв добавлен.', document.querySelector('[data-review-form]'));
        } catch (error) {
          const message = error.code === 'permission-denied'
            ? 'Firebase отклонил запись. Проверьте, что пользователь вошёл в аккаунт и последние Firestore Rules опубликованы.'
            : error.message;
          showInlineMessage(`Не удалось сохранить отзыв: ${message}`, reviewForm, 'error');
        }
        return;
      }

      setStoredReviews([review, ...getStoredReviews()]);
      reviewForm.reset();
      renderDetail();
      showInlineMessage('Отзыв сохранён на этом устройстве.', document.querySelector('[data-review-form]'));
    });
  }

  renderRelatedSpaces(space);
}

function renderBookings() {
  const root = document.querySelector('[data-bookings]');
  if (!root) return;

  const currentUser = getCurrentUser();
  if (!currentUser) {
    root.innerHTML = '<div class="empty-state">Войдите в аккаунт, чтобы просматривать бронирования.</div>';
    return;
  }

  const bookings = (currentUser.role === 'admin'
    ? getActiveBookings()
    : getBookings().filter((booking) => ['pending', 'confirmed'].includes(booking.status)))
    .filter((booking) => currentUser.role === 'admin' || booking.userId === currentUser.id)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const historyBookings = getBookings()
    .filter((booking) => booking.userId === currentUser.id
      && !['pending', 'confirmed'].includes(booking.status))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const historyIsOpen = Boolean(root.querySelector('[data-booking-history]')?.open);

  root.innerHTML = `
    ${bookings.length ? `
      <div class="table-list">
        <div class="table-row header">
          <div>Зона</div>
          <div>Дата</div>
          <div>Статус</div>
          <div>Сумма</div>
          <div>Действие</div>
        </div>
        ${bookings.map((booking) => {
    const workspace = getSpaces().find((space) => space.id === booking.workspaceId);
    return `
            <div class="table-row">
              <div>${escapeHtml(workspace ? workspace.title : 'Рабочая зона')}</div>
              <div>${formatDate(booking.date)}<br><small>${escapeHtml(booking.timeSlot || '')} · ${Number(booking.seats) || 1} чел.</small></div>
              <div><span class="badge ${booking.status === 'confirmed' ? '' : 'warning'}">${getBookingStatusLabel(booking.status)}</span></div>
              <div>${formatCurrency(booking.amount)}</div>
              <div>
                <button class="small-btn" data-delete-booking="${escapeHtml(booking.id)}">Удалить</button>
              </div>
            </div>
          `;
  }).join('')}
      </div>
    ` : '<div class="empty-state">Пока нет активных бронирований.</div>'}

    <details class="booking-history" data-booking-history ${historyIsOpen ? 'open' : ''}>
      <summary><span class="booking-history-label">История бронирований: <span class="muted">${historyBookings.length}</span></span></summary>
      <div class="booking-history-content">
        ${historyBookings.length ? `
          <div class="history-list">
            ${historyBookings.map((booking) => {
    const workspace = getSpaces().find((space) => space.id === booking.workspaceId);
    return `
                <article class="history-item">
                  <h4>${escapeHtml(workspace ? workspace.title : 'Рабочее место')}</h4>
                  <p><strong>${formatDate(booking.date)} · ${escapeHtml(booking.timeSlot || '')} · ${Number(booking.seats) || 1} чел.</strong></p>
                  <p><strong>Статус:</strong> <span ${booking.status === 'confirmed' ? '' : 'warning'}">${getBookingStatusLabel(booking.status)}</span></p>
                  <p><strong>Сумма:</strong> ${formatCurrency(booking.amount)}</p>
                  <button class="small-btn danger" type="button" data-delete-booking-history="${escapeHtml(booking.id)}">Удалить из истории</button>
                </article>
              `;
  }).join('')}
          </div>
        ` : '<div class="empty-state">История бронирований пуста.</div>'}
      </div>
    </details>
  `;

  document.querySelectorAll('[data-delete-booking-history]').forEach((button) => {
    button.addEventListener('click', async () => {
      const bookingId = button.dataset.deleteBookingHistory;
      const booking = historyBookings.find((item) => item.id === bookingId);
      if (!booking || !await requestInlineConfirmation('Удалить бронь из истории без возможности восстановления?', button)) return;

      try {
        if (CoworkingDB.isReady()) {
          await CoworkingDB.permanentlyDeleteBooking(bookingId);
        } else {
          saveJson(STORAGE_KEYS.bookings, getBookings().filter((item) => item.id !== bookingId));
          saveJson(STORAGE_KEYS.activeBookings, getActiveBookings().filter((item) => item.id !== bookingId));
          removeLocalBookedDate(booking.workspaceId, booking.date);
          const space = getSpaces().find((item) => item.id === booking.workspaceId);
          if (space?.lastBookingId === bookingId) setLocalSpaceStatus(booking.workspaceId, 'available');
        }
        renderBookings();
        renderProfile();
      } catch (error) {
        showInlineMessage(`Не удалось удалить бронь из истории: ${error.message}`, root, 'error');
      }
    });
  });

  document.querySelectorAll('[data-delete-booking]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const bookingId = button.dataset.deleteBooking;
        const booking = getBookings().find((item) => item.id === bookingId);
        if (window.CoworkingDB.isReady()) {
          await window.CoworkingDB.deleteBooking(bookingId);
        } else {
          const bookingsList = getBookings().map((item) => item.id === bookingId
            ? { ...item, status: 'cancelled' }
            : item);
          saveJson(STORAGE_KEYS.bookings, bookingsList);
          saveJson(STORAGE_KEYS.activeBookings, getActiveBookings().filter((item) => item.id !== bookingId));
          if (booking?.workspaceId) await releaseSpace(booking.workspaceId, booking.date);
          renderBookings();
        }

      } catch (error) {
        showInlineMessage(`Не удалось удалить бронирование: ${error.message}`, document.querySelector('main'), 'error');
      }
    });
  });

  document.querySelectorAll('[data-confirm-booking]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const bookingId = button.dataset.confirmBooking;
        const booking = getBookings().find((item) => item.id === bookingId);
        if (window.CoworkingDB.isReady()) {
          await window.CoworkingDB.updateBookingStatus(bookingId, 'confirmed');
        } else {
          const bookingsList = getBookings().map((item) => item.id === bookingId ? { ...item, status: 'confirmed' } : item);
          saveJson(STORAGE_KEYS.bookings, bookingsList);
          if (booking?.workspaceId) {
            setLocalSpaceStatus(booking.workspaceId, 'booked');
            const spaces = getSpaces().map((space) => (
              space.id === booking.workspaceId ? { ...space, lastBookingId: bookingId } : space
            ));
            saveJson(STORAGE_KEYS.spaces, spaces);
          }
          renderBookings();
        }

      } catch (error) {
        showInlineMessage(`Не удалось подтвердить бронирование: ${error.message}`, document.querySelector('main'), 'error');
      }
    });
  });
}

function renderProfile() {
  const root = document.querySelector('[data-profile]');
  if (!root) return;

  const currentUser = getCurrentUser();
  if (!currentUser) {
    root.innerHTML = '<div class="empty-state">Войдите в аккаунт, чтобы открыть личный кабинет.</div>';
    return;
  }

  const authUid = getActiveAuthUid();
  const reviews = getStoredReviews()
    .filter((review) => review.userId === authUid && String(review.comment || '').trim())
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const combinedHistory = reviews.map((review) => ({
    type: 'review',
    id: review.id,
    title: `Комментарий · ${getSpaces().find((item) => item.id === review.workspaceId)?.title || 'Рабочее место'}`,
    subtitle: `Оценка: ${review.rating}/5`,
    createdAt: review.createdAt,
    body: review.comment
  }));

  root.innerHTML = `
    <div class="profile-layout">
      <aside class="user-card">
        <div class="avatar">${String(currentUser.name || 'U').charAt(0)}</div>
        <h2>${currentUser.name}</h2>
        <p class="muted">${currentUser.role === 'admin' ? 'Администратор' : 'Пользователь'}</p>
        <div class="form-grid" style="margin-top: 1rem;">
          <label>
            <span class="muted">Имя</span>
            <input class="input" type="text" value="${currentUser.name}" data-user-name>
          </label>
          <label>
            <span class="muted">Email</span>
            <input class="input" type="email" value="${currentUser.email}" data-user-email>
          </label>
          <button class="btn primary" data-save-profile>Сохранить</button>
        </div>
      </aside>
      <section>
        <h2>История действий</h2>
        <div class="history-list">
          ${combinedHistory.length ? combinedHistory.map((entry) => `
            <article class="history-item">
              <h4>${entry.title}</h4>
              <p><strong>${entry.subtitle}</strong></p>
              <p>${escapeHtml(entry.body)}</p>
              <div class="history-actions" style="margin-top: 0.7rem; display: flex; gap: 0.5rem;">
                <button class="small-btn" data-edit-review="${entry.id}">Редактировать</button>
                <button class="small-btn danger" data-delete-review="${entry.id}">Удалить</button>
              </div>
              <small class="muted">${formatDate(entry.createdAt)}</small>
            </article>
          `).join('') : '<div class="empty-state">История пуста.</div>'}
        </div>
      </section>
    </div>
  `;

  const saveBtn = document.querySelector('[data-save-profile]');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const users = getUsers();
      const index = users.findIndex((user) => user.id === currentUser.id);
      if (index >= 0) {
        const profile = {
          name: document.querySelector('[data-user-name]').value,
          email: document.querySelector('[data-user-email]').value
        };

        try {
          if (window.CoworkingDB.isReady()) {
            await window.CoworkingDB.updateUserProfile(currentUser.id, profile);
          }
          users[index] = { ...users[index], ...profile };
          saveJson(STORAGE_KEYS.users, users);
          renderUserBadge();
          renderProfile();
          showInlineMessage('Профиль сохранен.', document.querySelector('[data-profile]'));
        } catch (error) {
          showInlineMessage(`Не удалось сохранить профиль: ${error.message}`, root, 'error');
        }
      }
    });
  }

  document.querySelectorAll('[data-delete-review]').forEach((button) => {
    button.addEventListener('click', async () => {
      const reviewId = button.dataset.deleteReview;
      try {
        if (CoworkingDB.isReady()) {
          const result = await CoworkingDB.deleteReview(reviewId);
          if (result && result.notFound) {
            reviewStore.items = getStoredReviews().filter((review) => review.id !== reviewId);
            renderProfile();
            return;
          }
        }

        setStoredReviews(getStoredReviews().filter((review) => review.id !== reviewId));
        renderProfile();
      } catch (error) {
        showInlineMessage(`Не удалось удалить отзыв: ${error.message}`, root, 'error');
      }
    });
  });

  document.querySelectorAll('[data-edit-review]').forEach((button) => {
    button.addEventListener('click', () => {
      const reviewId = button.dataset.editReview;
      const review = getStoredReviews().find((item) => item.id === reviewId);
      if (!review) return;

      const card = button.closest('.history-item');
      if (!card) return;

      card.innerHTML = `
        <form data-review-edit-form="${review.id}">
          <label>
            <span class="muted">Оценка</span>
            <select class="control-select" name="rating">
              <option value="5" ${review.rating === 5 ? 'selected' : ''}>5 — отлично</option>
              <option value="4" ${review.rating === 4 ? 'selected' : ''}>4 — хорошо</option>
              <option value="3" ${review.rating === 3 ? 'selected' : ''}>3 — нормально</option>
              <option value="2" ${review.rating === 2 ? 'selected' : ''}>2 — плохо</option>
              <option value="1" ${review.rating === 1 ? 'selected' : ''}>1 — очень плохо</option>
            </select>
          </label>
          <label>
            <span class="muted">Комментарий (необязательно)</span>
            <textarea class="input" name="comment" rows="3">${review.comment || ''}</textarea>
          </label>
          <div class="history-actions" style="margin-top: 0.7rem; display: flex; gap: 0.5rem;">
            <button class="small-btn success" type="submit">Сохранить</button>
            <button class="small-btn" type="button" data-cancel-edit-review="${review.id}">Отмена</button>
          </div>
        </form>
      `;

      const form = card.querySelector('[data-review-edit-form]');
      const cancelBtn = card.querySelector('[data-cancel-edit-review]');
      cancelBtn?.addEventListener('click', () => renderProfile());

      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const updatedReview = {
          rating: Number(formData.get('rating')) || review.rating,
          comment: String(formData.get('comment') || '').trim()
        };

        try {
          if (CoworkingDB.isReady()) {
            const result = await window.CoworkingDB.updateReview(reviewId, updatedReview);
            if (result && result.notFound) {
              reviewStore.items = getStoredReviews().filter((item) => item.id !== reviewId);
              renderProfile();
              showInlineMessage('Отзыв уже удален или отсутствует в базе. Список обновлен.', document.querySelector('[data-profile]'));
              return;
            }
          }

          setStoredReviews(getStoredReviews().map((item) => item.id === reviewId ? { ...item, ...updatedReview } : item));
          renderProfile();
        } catch (error) {
          showInlineMessage(`Не удалось обновить отзыв: ${error.message}`, form, 'error');
        }
      });
    });
  });
}

function closeSpaceEditModal() {
  const existingModal = document.getElementById('space-edit-modal');
  if (existingModal) {
    existingModal.remove();
  }
  document.body.style.overflow = '';
}

function openSpaceEditModal(spaceId) {
  if (!isAdmin()) {
    showInlineMessage('Редактирование доступно только администратору.', document.querySelector('main'), 'error');
    return;
  }

  const space = getSpaces().find((item) => item.id === spaceId);
  if (!space) {
    showInlineMessage('Помещение не найдено.', document.querySelector('main'), 'error');
    return;
  }

  closeSpaceEditModal();

  const modal = document.createElement('div');
  modal.id = 'space-edit-modal';
  modal.className = 'modal-overlay';

  const imageUrls = Array.isArray(space.images) && space.images.length
    ? space.images.filter(Boolean).join('\n')
    : (space.image || '');

  const featuresText = Array.isArray(space.features) ? space.features.join(', ') : '';
  const currentOccupied = space.status ? space.status === 'booked' : isSpaceOccupied(space);

  modal.innerHTML = `
    <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="modal-space-title">
      <div class="modal-header">
        <h3 id="modal-space-title">Редактировать помещение</h3>
        <button type="button" class="modal-close-btn" data-modal-close aria-label="Закрыть">&times;</button>
      </div>
      <div class="modal-body">
        <form data-edit-space-form>
        <div class="form-grid">
          <label>
            <span class="muted">Название</span>
            <input class="input" name="title" value="${escapeHtml(space.title || '')}" required />
          </label>

          <div class="form-row">
            <label>
              <span class="muted">Категория</span>
              <select class="control-select" name="category" required>
                <option value="Частный офис" ${space.category === 'Частный офис' ? 'selected' : ''}>Частный офис</option>
                <option value="Общая рабочая зона" ${space.category === 'Общая рабочая зона' ? 'selected' : ''}>Общая рабочая зона</option>
                <option value="Переговорная" ${space.category === 'Переговорная' ? 'selected' : ''}>Переговорная</option>
                <option value="Зал мероприятий" ${space.category === 'Зал мероприятий' ? 'selected' : ''}>Зал мероприятий</option>
                <option value="Тихая комната" ${space.category === 'Тихая комната' ? 'selected' : ''}>Тихая комната</option>
                <option value="Мастерская" ${space.category === 'Мастерская' ? 'selected' : ''}>Мастерская</option>
              </select>
            </label>

            <label>
              <span class="muted">Статус</span>
              <select class="control-select" name="status" id="edit-space-status">
                <option value="available" ${!currentOccupied ? 'selected' : ''}>Доступно</option>
                <option value="booked" ${currentOccupied ? 'selected' : ''}>Занято</option>
              </select>
            </label>
          </div>

          <div class="form-row">
            <label>
              <span class="muted">Город</span>
              <input class="input" name="city" value="${escapeHtml(space.city || '')}" placeholder="Например, Алматы" required />
            </label>

            <label>
              <span class="muted">Точное расположение (адрес)</span>
              <input class="input" name="address" value="${escapeHtml(space.address || space.city || '')}" placeholder="Например: пр. Абая, 150, Алматы" required />
            </label>
          </div>

          <div class="form-row">
            <label>
              <span class="muted">Цена за час, ₸</span>
              <input class="input" name="pricePerHour" type="number" min="0" step="500" value="${Number(space.pricePerHour) || 0}" required />
            </label>

            <label>
              <span class="muted">Вместимость, чел.</span>
              <input class="input" name="capacity" type="number" min="1" max="500" value="${Number(space.capacity) || 1}" required />
            </label>
          </div>

          <label>
            <span class="muted">Особенности / удобства (через запятую)</span>
            <input class="input" name="features" value="${escapeHtml(featuresText)}" placeholder="Wi‑Fi, Конференц-зал, Кофе" />
          </label>

          <label>
            <span class="muted">Ссылки на изображения (по одной на строку, первая — обложка)</span>
            <textarea class="input" name="images" rows="4" placeholder="https://images.unsplash.com/...">${escapeHtml(imageUrls)}</textarea>
          </label>

          <label>
            <span class="muted">Описание</span>
            <textarea class="input" name="description" rows="3" placeholder="Описание рабочего пространства">${escapeHtml(space.description || '')}</textarea>
          </label>
        </div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="small-btn" data-modal-delete style="background: var(--danger); font-size: 0.85rem;">Удалить карточку</button>
        <div class="actions-right">
          <button type="button" class="btn secondary compact" data-modal-close>Отмена</button>
          <button type="button" class="btn primary compact" data-modal-save>Сохранить изменения</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  modal.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', closeSpaceEditModal);
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeSpaceEditModal();
    }
  });

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      closeSpaceEditModal();
      document.removeEventListener('keydown', onKeyDown);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  function getModalFormData() {
    return new FormData(modal.querySelector('[data-edit-space-form]'));
  }

  const deleteBtn = modal.querySelector('[data-modal-delete]');
  deleteBtn?.addEventListener('click', async () => {
    if (!await requestInlineConfirmation(`Удалить рабочую зону «${space.title}»?`, deleteBtn)) return;

    try {
      if (window.CoworkingDB?.isReady?.() && window.CoworkingDB.deleteSpace) {
        await window.CoworkingDB.deleteSpace(spaceId);
      }
      const spacesList = getSpaces().filter((item) => item.id !== spaceId);
      saveJson(STORAGE_KEYS.spaces, spacesList);
      closeSpaceEditModal();
      renderCatalog();
      renderHomeStats();
      renderAdmin();
      renderDetail();
      showInlineMessage('Помещение удалено.', document.querySelector('main'));
    } catch (error) {
      showInlineMessage(`Не удалось удалить помещение: ${error.message}`, document.querySelector('main'), 'error');
    }
  });

  async function saveSpaceEdits() {
    const formData = getModalFormData();

    const imageUrlsList = String(formData.get('images') || '')
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);

    const primaryImage = imageUrlsList[0] || space.image || 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80';
    const galleryImages = normalizeSpaceGallery({
      image: primaryImage,
      images: imageUrlsList.length ? imageUrlsList : [primaryImage]
    });

    const rawFeatures = String(formData.get('features') || '');
    const featuresList = rawFeatures
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);

    const statusSelect = modal.querySelector('#edit-space-status');
    const chosenStatus = (statusSelect ? statusSelect.value : null) || formData.get('status') || space.status || 'available';

    const updates = {
      title: String(formData.get('title') || '').trim() || space.title,
      category: String(formData.get('category') || '').trim() || space.category,
      city: String(formData.get('city') || '').trim() || space.city,
      address: String(formData.get('address') || '').trim() || space.address || space.city,
      pricePerHour: Number(formData.get('pricePerHour')) || space.pricePerHour,
      capacity: Number(formData.get('capacity')) || space.capacity,
      status: chosenStatus,
      features: featuresList.length ? featuresList : (space.features || ['Wi‑Fi']),
      description: String(formData.get('description') || '').trim() || space.description || '',
      image: primaryImage,
      images: galleryImages,
      galleryMode: 'custom'
    };

    try {
      if (window.CoworkingDB?.isReady?.() && window.CoworkingDB.updateSpace) {
        await window.CoworkingDB.updateSpace(spaceId, updates);
      }

      const spacesList = getSpaces().map((item) => (item.id === spaceId ? { ...item, ...updates } : item));
      saveJson(STORAGE_KEYS.spaces, spacesList);

      if (chosenStatus === 'available') {
        const bookingsList = getBookings().map((booking) => (
          String(booking.workspaceId) === String(spaceId) && booking.status !== 'cancelled' && booking.status !== 'expired'
            ? { ...booking, status: 'cancelled' }
            : booking
        ));
        saveJson(STORAGE_KEYS.bookings, bookingsList);
      }

      closeSpaceEditModal();
      renderCatalog();
      renderHomeStats();
      renderAdmin();
      renderDetail();
      showInlineMessage('Данные помещения сохранены.', document.querySelector('main'));
    } catch (error) {
      showInlineMessage(`Не удалось обновить рабочую зону: ${error.message}`, document.querySelector('main'), 'error');
    }
  }

  const saveBtn = modal.querySelector('[data-modal-save]');
  saveBtn?.addEventListener('click', saveSpaceEdits);

  const form = modal.querySelector('[data-edit-space-form]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSpaceEdits();
  });
}

function renderAdmin() {
  const root = document.querySelector('[data-admin]');
  if (!root) return;

  if (!isAdmin()) {
    root.innerHTML = '<div class="empty-state">Доступ разрешён только администратору.</div>';
    return;
  }

  if (CoworkingDB.isReady() && !adminDataLoaded) {
    root.innerHTML = '<div class="empty-state">Загрузка данных админ-панели…</div>';
    if (!adminDataPromise) {
      adminDataPromise = Promise.all([
        CoworkingDB.getSpaces(),
        CoworkingDB.getUsers(),
        CoworkingDB.getBookings(),
        CoworkingDB.getReviews()
      ]).then(([spaces, users, bookings, reviews]) => {
        saveJson(STORAGE_KEYS.spaces, spaces);
        saveJson(STORAGE_KEYS.users, users);
        saveJson(STORAGE_KEYS.bookings, bookings);
        reviewStore.items = reviews;
        adminDataLoaded = true;
        renderAdmin();
      }).catch((error) => {
        adminDataPromise = null;
        root.innerHTML = `<div class="empty-state">Не удалось загрузить данные админ-панели: ${escapeHtml(error.message)}</div>`;
      });
    }
    return;
  }

  const spaces = getSpaces();
  const users = [...getUsers()].sort((first, second) => (
    Number(second.role === 'admin') - Number(first.role === 'admin')
  ));
  const bookings = getBookings().filter((booking) => !booking.hiddenFromAdmin);

  root.innerHTML = `
    <div class="admin-grid">
      <div class="stat-card"><strong>${formatNumber(spaces.length)}</strong> рабочих зон</div>
      <div class="stat-card"><strong>${formatNumber(bookings.filter((b) => b.status === 'confirmed').length)}</strong> подтверждено</div>
      <div class="stat-card"><strong>${formatNumber(bookings.reduce((sum, item) => (
        item.status === 'confirmed' ? sum + (Number(item.amount) || 0) : sum
      ), 0))}</strong> оборот</div>
    </div>
    <div class="admin-sections">
      <div class="form-box">
        <h3>Добавить рабочую зону</h3>
        <form data-space-form>
          <div class="form-grid">
            <input class="input" name="title" placeholder="Название" required>
            <select class="control-select" name="category" required>
              <option value="Частный офис">Частный офис</option>
              <option value="Общая рабочая зона">Общая рабочая зона</option>
              <option value="Переговорная">Переговорная</option>
              <option value="Зал мероприятий">Зал мероприятий</option>
              <option value="Тихая комната">Тихая комната</option>
              <option value="Мастерская">Мастерская</option>
            </select>
            <input class="input" name="city" placeholder="Например, Алматы" required>
            <input class="input" name="address" placeholder="Точное расположение офиса" required>
            <input class="input" name="pricePerHour" type="number" placeholder="Цена за час, ₸" required>
            <input class="input" name="capacity" type="number" placeholder="Вместимость, чел." required>
            <textarea class="input" name="images" rows="4" placeholder="Ссылки на изображения (по одной на строку)"></textarea>
            <textarea name="description" placeholder="Описание"></textarea>
            <button class="btn primary" type="submit">Сохранить</button>
          </div>
        </form>
      </div>
    </div>

    <div class="section" data-admin-zones-section style="padding-top: 1.5rem;">
      <button type="button" class="admin-accordion-toggle" id="zones-accordion-btn" aria-expanded="false" aria-controls="zones-accordion-body" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f8faff; border:1px solid var(--border); border-radius:16px; padding:1rem 1.25rem; cursor:pointer; text-align:left;">
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <h3 style="margin:0; font-size:1.1rem;">Управление рабочими зонами</h3>
          <span class="badge" style="background:#e8edf8; color:var(--primary); font-weight:600;">${spaces.length}</span>
        </div>
        <span class="accordion-arrow" style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:8px; background:#e8ecf4; transition:transform 0.25s ease; transform:rotate(0deg);">&#9660;</span>
      </button>
      <div id="zones-accordion-body" style="display:none; margin-top:0.75rem;">
        <div class="admin-spaces-table">
          <div class="admin-space-row header">
            <div>Фото</div>
            <div>Название</div>
            <div>Расположение</div>
            <div>Цена / Мест</div>
            <div>Статус</div>
            <div>Действия</div>
          </div>
          ${spaces.length ? spaces.map((item) => `
            <div class="admin-space-row">
              <div class="admin-space-thumb" style="background-image: url('${escapeHtml(item.image || (Array.isArray(item.images) && item.images[0]) || '')}')"></div>
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <div class="muted"><small>${escapeHtml(item.category)}</small></div>
              </div>
              <div>
                <div>${escapeHtml(item.city)}</div>
                <div class="muted"><small>${escapeHtml(item.address || item.city)}</small></div>
              </div>
              <div>
                <strong>${formatPrice(item.pricePerHour)}</strong>
                <div class="muted"><small>до ${item.capacity} чел.</small></div>
              </div>
              <div>
                <span class="badge ${item.status === 'booked' ? 'warning' : ''}">${item.status === 'booked' ? 'Занято' : 'Доступно'}</span>
              </div>
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                <button class="small-btn primary" type="button" data-edit-space="${item.id}">Редактировать</button>
                <button class="small-btn" type="button" data-delete-space="${item.id}">Удалить</button>
              </div>
            </div>
          `).join('') : '<div class="empty-state">Нет рабочих зон.</div>'}
        </div>
      </div>
    </div>

    <div class="section" data-admin-bookings-section style="padding-top: 1.5rem;">
      <h3>Все бронирования</h3>
      <div class="table-list">
        <div class="table-row header">
          <div>Пользователь</div>
          <div>Помещение</div>
          <div>Дата</div>
          <div>Статус</div>
          <div>Сумма</div>
          <div>Изменить статус</div>
        </div>
        ${bookings.length ? bookings.map((booking) => {
    const user = users.find((person) => person.id === booking.userId);
    const workspace = spaces.find((item) => item.id === booking.workspaceId);
    const statuses = ['pending', 'confirmed', 'completed', 'cancelled', 'expired'];
    return `
            <div class="table-row">
              <div>
                <div>${escapeHtml(user ? user.name : 'Пользователь')}</div>
                <div class="muted"><small>${escapeHtml(user?.email || `UID: ${booking.userId}`)}</small></div>
              </div>
              <div>${escapeHtml(workspace ? workspace.title : 'Не указано')}</div>
              <div>${formatDate(booking.date)}<br><small>${escapeHtml(booking.timeSlot || '')} · ${Number(booking.seats) || 1} чел.</small></div>
              <div><span class="badge ${booking.status === 'confirmed' ? '' : 'warning'}">${getBookingStatusLabel(booking.status)}</span></div>
              <div>${formatCurrency(booking.amount)}</div>
              <div style="display:flex; gap:.4rem; flex-wrap:wrap;">
                <select class="control-select" data-booking-status="${escapeHtml(booking.id)}">
                  ${statuses.map((status) => `<option value="${status}" ${booking.status === status ? 'selected' : ''}>${getBookingStatusLabel(status)}</option>`).join('')}
                </select>
                <button class="small-btn primary" type="button" data-save-booking-status="${escapeHtml(booking.id)}">Сохранить</button>
                <button class="small-btn danger" type="button" data-delete-admin-booking="${escapeHtml(booking.id)}">Удалить</button>
              </div>
            </div>
          `;
  }).join('') : '<div class="empty-state" style="margin-top: 1rem;">Бронирований пока нет.</div>'}
      </div>
    </div>

    <div class="section" style="padding-top: 1.5rem;">
      <button type="button" class="admin-accordion-toggle" id="users-accordion-btn" aria-expanded="false" aria-controls="users-accordion-body" style="width:100%; display:flex; align-items:center; justify-content:space-between; background:#f8faff; border:1px solid var(--border); border-radius:16px; padding:1rem 1.25rem; cursor:pointer; text-align:left;">
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <h3 style="margin:0; font-size:1.1rem;">Пользователи и роли</h3>
          <span class="badge" style="background:#e8edf8; color:var(--primary); font-weight:600;">${users.length}</span>
        </div>
        <span class="accordion-arrow" style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:8px; background:#e8ecf4; transition:transform 0.25s ease; transform:rotate(0deg);">&#9660;</span>
      </button>
      <div id="users-accordion-body" style="display:none; margin-top:0.75rem;">
        <div class="table-list">
          <div class="table-row header"><div>Имя</div><div>Email</div><div>Роль</div><div>Управление</div></div>
        ${users.length ? users.map((user) => `
          <div class="table-row">
            <div>${escapeHtml(user.name || 'Пользователь')}</div>
            <div>${escapeHtml(user.email || '')}</div>
            <div>
              <select class="control-select" data-user-role="${escapeHtml(user.id)}" ${user.id === getCurrentUser()?.id ? 'disabled' : ''}>
                <option value="user" ${user.role === 'user' ? 'selected' : ''}>Пользователь</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Администратор</option>
              </select>
            </div>
            <div><button class="small-btn primary" type="button" data-save-user-role="${escapeHtml(user.id)}" ${user.id === getCurrentUser()?.id ? 'disabled' : ''}>Сохранить роль</button></div>
          </div>
        `).join('') : '<div class="empty-state">Пользователей пока нет.</div>'}
        </div>
      </div>
    </div>

    <div class="section" style="padding-top: 1.5rem;">
      <h3>Модерация отзывов</h3>
      <div class="history-list">
        ${reviewStore.items.length ? reviewStore.items.map((review) => `
          <article class="history-item">
            <h4>${escapeHtml(review.userName || 'Пользователь')} · ${Number(review.rating) || 0}/5</h4>
            <p>${escapeHtml(review.comment || '')}</p>
            <small class="muted">${escapeHtml(spaces.find((item) => item.id === review.workspaceId)?.title || 'Рабочая зона')} · ${formatDate(review.createdAt)}</small>
            <p><button class="small-btn danger" type="button" data-moderate-review="${escapeHtml(review.id)}">Удалить отзыв</button></p>
          </article>
        `).join('') : '<div class="empty-state">Отзывов для модерации нет.</div>'}
      </div>
    </div>
  `;

  const bookingsSection = root.querySelector('[data-admin-bookings-section]');
  const zonesSection = root.querySelector('[data-admin-zones-section]');
  if (bookingsSection && zonesSection) root.insertBefore(bookingsSection, zonesSection);

  document.querySelectorAll('[data-delete-space]').forEach((button) => {
    button.addEventListener('click', async () => {
      const spaceId = button.dataset.deleteSpace;
      const spaceItem = spaces.find((s) => s.id === spaceId);
      const spaceName = spaceItem ? spaceItem.title : 'это помещение';
      if (!await requestInlineConfirmation(`Удалить рабочую зону «${spaceName}»?`, button)) {
        return;
      }
      try {
        if (window.CoworkingDB?.isReady?.() && window.CoworkingDB.deleteSpace) {
          await window.CoworkingDB.deleteSpace(spaceId);
        }
        const spacesList = getSpaces().filter((item) => item.id !== spaceId);
        saveJson(STORAGE_KEYS.spaces, spacesList);
        renderAdmin();
        renderHomeStats();
        renderCatalog();
        showInlineMessage('Помещение удалено.', document.querySelector('main'));
      } catch (error) {
        showInlineMessage(`Не удалось удалить помещение: ${error.message}`, root, 'error');
      }
    });
  });

  const spaceForm = document.querySelector('[data-space-form]');
  if (spaceForm) {
    spaceForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(spaceForm);
      const imageUrls = String(formData.get('images') || '')
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean);

      const primaryImage = imageUrls[0] || 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80';
      const galleryImages = normalizeSpaceGallery({
        image: primaryImage,
        images: imageUrls.length ? imageUrls : [primaryImage]
      });

      const newSpace = {
        id: `space_${Date.now()}`,
        title: formData.get('title'),
        category: formData.get('category'),
        city: formData.get('city'),
        country: 'Казахстан',
        address: String(formData.get('address') || '').trim() || 'Адрес не указан',
        pricePerHour: Number(formData.get('pricePerHour')) || 0,
        priceCurrency: 'KZT',
        capacity: Number(formData.get('capacity')) || 1,
        description: formData.get('description') || 'Новая рабочая зона.',
        features: ['Wi‑Fi', 'Конференц-зал', 'Кофе'],
        status: 'available',
        rating: 0,
        image: primaryImage,
        images: galleryImages,
        galleryMode: 'custom'
      };
      try {
        if (window.CoworkingDB.isReady()) {
          await window.CoworkingDB.createSpace(newSpace);
        } else {
          const spacesList = getSpaces();
          spacesList.unshift(newSpace);
          saveJson(STORAGE_KEYS.spaces, spacesList);
          renderAdmin();
          renderHomeStats();
          renderCatalog();
        }
        spaceForm.reset();
        showInlineMessage('Рабочая зона создана.', document.querySelector('[data-admin]'));
      } catch (error) {
        showInlineMessage(`Не удалось создать рабочую зону: ${error.message}`, spaceForm, 'error');
      }
    });
  }

  document.querySelectorAll('[data-save-booking-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const bookingId = button.dataset.saveBookingStatus;
      const status = document.querySelector(`[data-booking-status="${bookingId}"]`)?.value;
      if (!status) return;
      try {
        if (CoworkingDB.isReady()) {
          await CoworkingDB.updateBookingStatus(bookingId, status);
        }
        const booking = getBookings().find((item) => item.id === bookingId);
        const updated = getBookings().map((item) => item.id === bookingId ? { ...item, status } : item);
        saveJson(STORAGE_KEYS.bookings, updated);
        if (booking && ['pending', 'confirmed'].includes(status)) {
          saveJson(STORAGE_KEYS.activeBookings, [
            { ...booking, status },
            ...getActiveBookings().filter((item) => item.id !== bookingId)
          ]);
          if (status === 'confirmed') {
            const spaces = getSpaces().map((space) => space.id === booking.workspaceId
              ? { ...space, status: 'booked', lastBookingId: bookingId }
              : space);
            saveJson(STORAGE_KEYS.spaces, spaces);
          }
        } else if (booking) {
          saveJson(STORAGE_KEYS.activeBookings, getActiveBookings().filter((item) => item.id !== bookingId));
          const spaces = getSpaces().map((space) => {
            if (space.id !== booking.workspaceId) return space;
            const bookedDates = (space.bookedDates || []).filter((date) => date !== booking.date);
            return {
              ...space,
              bookedDates,
              ...(space.lastBookingId === bookingId ? { status: 'available' } : {})
            };
          });
          saveJson(STORAGE_KEYS.spaces, spaces);
        }
        renderAdmin();
      } catch (error) {
        showInlineMessage(`Не удалось изменить статус бронирования: ${error.message}`, root, 'error');
      }
    });
  });

  document.querySelectorAll('[data-delete-admin-booking]').forEach((button) => {
    button.addEventListener('click', async () => {
      const bookingId = button.dataset.deleteAdminBooking;
      const booking = getBookings().find((item) => item.id === bookingId);
      if (!booking || !await requestInlineConfirmation(
        'Удалить заказ из активных списков? Он останется в истории пользователя.',
        button
      )) return;

      try {
        if (CoworkingDB.isReady()) {
          await CoworkingDB.deleteBooking(bookingId, true);
        } else {
          const updated = getBookings().map((item) => item.id === bookingId
            ? {
              ...item,
              ...(['pending', 'confirmed'].includes(item.status) ? { status: 'cancelled' } : {}),
              hiddenFromAdmin: true
            }
            : item);
          saveJson(STORAGE_KEYS.bookings, updated);
          saveJson(STORAGE_KEYS.activeBookings, getActiveBookings().filter((item) => item.id !== bookingId));
          if (booking.workspaceId) await releaseSpace(booking.workspaceId, booking.date);
        }
        renderAdmin();
        renderBookings();
        renderProfile();
        showInlineMessage('Заказ удалён из списка и сохранён в истории пользователя.', root);
      } catch (error) {
        showInlineMessage(`Не удалось удалить заказ: ${error.message}`, root, 'error');
      }
    });
  });

  document.querySelectorAll('[data-save-user-role]').forEach((button) => {
    button.addEventListener('click', async () => {
      const uid = button.dataset.saveUserRole;
      const role = document.querySelector(`[data-user-role="${uid}"]`)?.value;
      if (!role || uid === getCurrentUser()?.id) return;
      try {
        await CoworkingDB.setUserRole(uid, role);
        const updated = getUsers().map((user) => user.id === uid ? { ...user, role } : user);
        saveJson(STORAGE_KEYS.users, updated);
        renderAdmin();
      } catch (error) {
        showInlineMessage(`Не удалось изменить роль пользователя: ${error.message}`, root, 'error');
      }
    });
  });

  document.querySelectorAll('[data-moderate-review]').forEach((button) => {
    button.addEventListener('click', async () => {
      const reviewId = button.dataset.moderateReview;
      if (!await requestInlineConfirmation('Удалить этот отзыв?', button)) return;
      try {
        await CoworkingDB.deleteReview(reviewId);
        reviewStore.items = reviewStore.items.filter((review) => review.id !== reviewId);
        renderAdmin();
      } catch (error) {
        showInlineMessage(`Не удалось удалить отзыв: ${error.message}`, root, 'error');
      }
    });
  });

  [
    ['zones-accordion-btn', 'zones-accordion-body'],
    ['users-accordion-btn', 'users-accordion-body']
  ].forEach(([buttonId, bodyId]) => {
    const accordionBtn = document.getElementById(buttonId);
    const accordionBody = document.getElementById(bodyId);
    if (!accordionBtn || !accordionBody) return;

    accordionBtn.addEventListener('click', () => {
      const isOpen = accordionBody.style.display !== 'none';
      accordionBody.style.display = isOpen ? 'none' : 'block';
      accordionBtn.setAttribute('aria-expanded', String(!isOpen));
      const arrow = accordionBtn.querySelector('.accordion-arrow');
      if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
    });
  });
}

function renderLogin() {
  initAuthForms();
}

function renderHomeStats() {
  const spaces = getSpaces();
  const cards = document.querySelectorAll('[data-stat]');
  if (!cards.length) return;
  cards[0].textContent = formatNumber(spaces.length);
  cards[1].textContent = spaces.length
    ? formatCurrency(Math.min(...spaces.map((space) => space.pricePerHour)))
    : formatCurrency(0);
  cards[2].textContent = formatNumber(new Set(spaces.map((space) => space.city).filter(Boolean)).size);
}

function setPageContext() {
  const pathname = window.location.pathname.split('/').pop() || 'index.html';
  const page = document.body.dataset.page || pathname;

  if (page === 'index' || pathname === 'index.html' || pathname === '') {
    document.body.dataset.page = 'index';
  }
}

window.bookingStatusTimer = window.bookingStatusTimer || null;

function startBookingStatusTimer() {
  if (window.bookingStatusTimer) return;

  window.bookingStatusTimer = window.setInterval(() => {
    synchronizeExpiredBookings().catch((error) => console.warn('Expired booking sync warning:', error));
  }, 30000);
}

document.addEventListener('DOMContentLoaded', () => {
  injectSiteFooter();
  ensureSeedData();
  initializeFirebase();
  synchronizeExpiredBookings().catch((error) => console.warn('Expired booking sync warning:', error));
  startBookingStatusTimer();
  setPageContext();
  renderUserBadge();

  document.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-edit-space]');
    if (editBtn) {
      const spaceId = editBtn.dataset.editSpace;
      if (spaceId) {
        openSpaceEditModal(spaceId);
      }
    }
  });

  const page = document.body.dataset.page || window.location.pathname.split('/').pop();

  if (page === 'index' || page === 'index.html') {
    bindCatalogControls();
    renderHomeStats();
    renderCatalog();
  }

  if (page === 'detail.html' || page === 'detail') {
    renderDetail();
  }

  if (page === 'bookings.html' || page === 'bookings') {
    renderBookings();
  }

  if (page === 'profile.html' || page === 'profile') {
    syncReviewOwnerIds().catch((error) => console.warn('Review owner sync warning:', error));
    renderProfile();
  }

  if (page === 'admin.html' || page === 'admin') {
    renderAdmin();
  }

  if (page === 'login.html' || page === 'login') {
    renderLogin();
  }
});
