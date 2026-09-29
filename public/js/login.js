async function syncUserProfile(uid, email, name) {
  const db = window.firebase.firestore();
  const userRef = db.collection('users').doc(uid);
  const currentUserDoc = await userRef.get();

  const emailLower = String(email || '').toLowerCase();
  const profile = {
    id: uid,
    email: emailLower,
    name: name || emailLower.split('@')[0],
    role: currentUserDoc.exists && currentUserDoc.data().role ? currentUserDoc.data().role : 'user',
    createdAt: currentUserDoc.exists && currentUserDoc.data().createdAt ? currentUserDoc.data().createdAt : new Date().toISOString()
  };

  await userRef.set(profile, { merge: true });

  const localUsers = JSON.parse(localStorage.getItem('coworking_users') || '[]');
  const userIndex = localUsers.findIndex((user) => user.id === uid);
  if (userIndex >= 0) {
    localUsers[userIndex] = profile;
  } else {
    localUsers.push(profile);
  }

  localStorage.setItem('coworking_users', JSON.stringify(localUsers));
  localStorage.setItem('coworking_current_user', uid);

  return profile;
}

async function registerUser(name, email, password) {
  const auth = window.firebase.auth();
  const emailLower = String(email || '').trim().toLowerCase();
  let result;
  try {
    result = await auth.createUserWithEmailAndPassword(emailLower, password);
  } catch (error) {
    const messages = {
      'auth/email-already-in-use': 'Аккаунт с этой почтой уже существует. Войдите вместо регистрации.',
      'auth/invalid-email': 'Проверьте адрес электронной почты.',
      'auth/weak-password': 'Пароль слишком простой. Выберите более надежный пароль.',
      'auth/operation-not-allowed': 'В Firebase Authentication не включён вход по Email/Password.',
      'auth/network-request-failed': 'Нет соединения с интернетом. Попробуйте ещё раз.'
    };
    throw new Error(messages[error.code] || error.message || 'Не удалось создать аккаунт. Попробуйте ещё раз.');
  }
  const uid = result.user.uid;

  await syncUserProfile(uid, emailLower, name);
  return result.user;
}

async function loginUser(email, password) {
  const auth = window.firebase.auth();
  const db = window.firebase.firestore();

  const emailLower = String(email || '').trim().toLowerCase();
  const result = await auth.signInWithEmailAndPassword(emailLower, password);
  const uid = result.user.uid;

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    await syncUserProfile(uid, email, email.split('@')[0]);
  } else {
    const profile = userDoc.data();
    localStorage.setItem('coworking_current_user', uid);

    const localUsers = JSON.parse(localStorage.getItem('coworking_users') || '[]');
    const userIndex = localUsers.findIndex((user) => user.id === uid);
    if (userIndex >= 0) {
      localUsers[userIndex] = { ...profile, id: uid };
    } else {
      localUsers.push({ ...profile, id: uid });
    }

    localStorage.setItem('coworking_users', JSON.stringify(localUsers));
  }

  return result.user;
}

export function initAuthForms() {
  const loginForm = document.querySelector('[data-login-form]');
  const registerForm = document.querySelector('[data-register-form]');
  const tabButtons = document.querySelectorAll('[data-auth-tab]');
  const passwordResetButton = loginForm && loginForm.querySelector('[data-password-reset]');
  const passwordResetMessage = loginForm && loginForm.querySelector('[data-password-reset-message]');

  if (!loginForm || !registerForm) return;

  tabButtons.forEach((tab) => {
    tab.addEventListener('click', () => {
      const isLogin = tab.dataset.authTab === 'login';
      tabButtons.forEach((btn) => btn.classList.toggle('active', btn === tab));
      loginForm.classList.toggle('hidden', !isLogin);
      registerForm.classList.toggle('hidden', isLogin);
    });
  });

  if (passwordResetButton && passwordResetMessage) {
    passwordResetButton.addEventListener('click', async () => {
      const emailInput = loginForm.elements.email;
      const email = emailInput.value.trim();

      passwordResetMessage.textContent = '';
      passwordResetMessage.hidden = true;

      if (!email || !emailInput.checkValidity()) {
        passwordResetMessage.textContent = 'Введите корректный адрес электронной почты.';
        passwordResetMessage.hidden = false;
        emailInput.reportValidity();
        return;
      }

      passwordResetButton.disabled = true;
      passwordResetMessage.textContent = 'Отправляем ссылку для сброса пароля…';
      passwordResetMessage.hidden = false;

      try {
        window.firebase.auth().languageCode = 'ru';
        await window.firebase.auth().sendPasswordResetEmail(email);
        passwordResetMessage.textContent = 'Если аккаунт с этой почтой существует, ссылка отправлена. Проверьте папку «Спам».';
      } catch (error) {
        const messages = {
          'auth/invalid-email': 'Проверьте адрес электронной почты.',
          'auth/too-many-requests': 'Слишком много запросов. Попробуйте позже.',
          'auth/operation-not-allowed': 'В Firebase Authentication не включён вход по Email/Password.',
          'auth/network-request-failed': 'Нет соединения с интернетом. Попробуйте ещё раз.',
          'auth/unauthorized-continue-uri': 'Домен сайта не добавлен в разрешённые домены Firebase.'
        };
        passwordResetMessage.textContent = messages[error.code]
          || error.message
          || 'Не удалось отправить ссылку для сброса пароля.';
      } finally {
        passwordResetButton.disabled = false;
      }
    });
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const email = formData.get('email');
    const password = formData.get('password');

    try {
      await loginUser(email, password);
      window.location.href = 'index.html';
    } catch (error) {
      window.showInlineMessage(error.message, loginForm, 'error');
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const name = formData.get('name');
    const email = formData.get('email');
    const password = formData.get('password');
    try {
      await registerUser(name, email, password);
      window.location.href = 'index.html';
    } catch (error) {
      window.showInlineMessage(error.message, registerForm, 'error');
    }
  });
}

