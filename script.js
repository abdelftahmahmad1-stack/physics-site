(() => {
  "use strict";

  const STORAGE_KEY = "madar-physics-v1";
  const TEACHER_ACCOUNT_KEY = "madar-teacher-account-v1";
  const STUDENT_ACCOUNTS_KEY = "madar-student-accounts-v1";
  const SESSION_KEY = "madar-session-v1";
  const THEME_KEY = "madar-theme-v1";
  const TEACHER_USERNAME = "احمد بدر";
  const TEACHER_PASSWORD = "ahmad badr";
  const TEACHER_CREDENTIAL_VERSION = 2;
  const STUDENT_GRADES = ["الأول الثانوي", "الثاني الثانوي", "الثالث الثانوي"];
  const ALL_GRADES = "all";
  const TEACHER_NAME = "أحْمَدْ بَدْر";
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const questionImageState = new WeakMap();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const emptyStore = () => ({ students: [], tests: [], videos: [], scores: [], attempts: [] });

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function readStore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return emptyStore();
      const parsed = JSON.parse(saved);
      return { ...emptyStore(), ...parsed };
    } catch (error) {
      console.error("تعذر قراءة بيانات المنصة المحفوظة.", error);
      showToast("تعذر تحميل البيانات المحفوظة من هذا المتصفح.");
      return emptyStore();
    }
  }

  let store = readStore();
  let currentUser = null;
  let authMode = "student-login";
  let activeTest = null;
  let currentTestIndex = 0;
  let answers = [];
  let selectedStudentReportId = null;

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (error) {
      console.error("تعذر حفظ بيانات المنصة.", error);
      showToast("تعذر حفظ البيانات. قد تكون مساحة التخزين ممتلئة.");
      return false;
    }
  }

  function setAccountStatus(message) {
    const status = $("#account-status");
    if (!status) return;
    status.classList.remove("connected");
    status.innerHTML = `<span class="cloud-status-dot"></span><span>${escapeHtml(message)}</span>`;
  }

  function readTeacherAccount() {
    try {
      const saved = localStorage.getItem(TEACHER_ACCOUNT_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error("تعذر قراءة حساب المدرّس المحلي.", error);
      showToast("تعذر قراءة حساب المدرّس من هذا المتصفح.");
      return null;
    }
  }

  function saveTeacherAccount(account) {
    try {
      localStorage.setItem(TEACHER_ACCOUNT_KEY, JSON.stringify(account));
      return true;
    } catch (error) {
      console.error("تعذر حفظ حساب المدرّس المحلي.", error);
      showToast("تعذر حفظ حساب المدرّس في هذا المتصفح.");
      return false;
    }
  }

  function readStudentAccounts() {
    try {
      const saved = localStorage.getItem(STUDENT_ACCOUNTS_KEY);
      const accounts = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(accounts)) throw new TypeError("Student account data must be an array.");
      return accounts;
    } catch (error) {
      console.error("تعذر قراءة حسابات الطلاب المحلية.", error);
      showToast("تعذر قراءة حسابات الطلاب من هذا المتصفح.");
      return [];
    }
  }

  function saveStudentAccounts(accounts) {
    try {
      localStorage.setItem(STUDENT_ACCOUNTS_KEY, JSON.stringify(accounts));
      return true;
    } catch (error) {
      console.error("تعذر حفظ حسابات الطلاب المحلية.", error);
      showToast("تعذر حفظ حساب الطالب في هذا المتصفح.");
      return false;
    }
  }

  function bytesToHex(bytes) {
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashTeacherPassword(password, saltHex) {
    if (!crypto.subtle) {
      throw new Error("تشفير كلمة المرور غير متاح. افتح الموقع من localhost أو HTTPS.");
    }
    const salt = Uint8Array.from(saltHex.match(/.{2}/g), pair => Number.parseInt(pair, 16));
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const result = await crypto.subtle.deriveBits({
      name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256"
    }, key, 256);
    return bytesToHex(new Uint8Array(result));
  }

  function localTeacherUser(account) {
    return {
      id: "local-teacher",
      name: "احمد بدر",
      username: account.username,
      grade: "",
      phone: "",
      guardianPhone: "",
      status: "approved",
      role: "teacher",
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt || null
    };
  }

  function localStudentUser(account) {
    return {
      id: account.id,
      name: account.name,
      username: account.username,
      grade: account.grade,
      phone: account.phone || "",
      guardianPhone: account.guardianPhone || "",
      status: "approved",
      role: "student",
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt || null
    };
  }

  function setLocalSession(user) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, role: user.role }));
  }

  function normalizeUsername(username) {
    return username.trim().toLocaleLowerCase("ar");
  }

  function normalizePhone(value) {
    return String(value || "").replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "");
  }

  function validOptionalPhone(phone) {
    return !phone || /^01\d{9}$/.test(phone);
  }

  function hasUsedTestAttempt(studentId, testId) {
    return store.scores.some(score => score.studentId === studentId && score.testId === testId)
      || store.attempts.some(attempt => attempt.studentId === studentId && attempt.testId === testId);
  }

  function testsForStudent(student) {
    return store.tests.filter(test => !test.grade || test.grade === ALL_GRADES || test.grade === student.grade);
  }

  async function ensureTeacherAccount() {
    const existing = readTeacherAccount();
    if (existing?.credentialVersion === TEACHER_CREDENTIAL_VERSION
        && existing.username === TEACHER_USERNAME
        && existing.salt
        && existing.passwordHash) {
      return existing;
    }

    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const account = {
      credentialVersion: TEACHER_CREDENTIAL_VERSION,
      username: TEACHER_USERNAME,
      salt,
      passwordHash: await hashTeacherPassword(TEACHER_PASSWORD, salt),
      createdAt: existing?.createdAt || new Date().toISOString(),
      lastLoginAt: null
    };
    return saveTeacherAccount(account) ? account : null;
  }

  function usernameExists(username) {
    const normalized = normalizeUsername(username);
    const teacherAccount = readTeacherAccount();
    return Boolean(
      (teacherAccount && normalizeUsername(teacherAccount.username) === normalized)
      || readStudentAccounts().some(account => normalizeUsername(account.username) === normalized)
    );
  }

  async function submitLocalTeacherAuth(form) {
    const message = $("#auth-message");
    const formData = new FormData(form);
    const password = String(formData.get("password") || "");
    const username = String(formData.get("username") || "").trim();
    const account = readTeacherAccount();

    try {
      if (!account) {
        message.textContent = "تعذر تجهيز حساب المدرّس. حدّث الصفحة وحاول مرة أخرى.";
        return;
      }
      if (normalizeUsername(username) !== normalizeUsername(account.username)) {
        message.textContent = "اسم المستخدم غير صحيح.";
        return;
      }
      if (await hashTeacherPassword(password, account.salt) !== account.passwordHash) {
        message.textContent = "كلمة المرور غير صحيحة.";
        return;
      }
      account.lastLoginAt = new Date().toISOString();
      if (!saveTeacherAccount(account)) return;
      currentUser = localTeacherUser(account);
      setLocalSession(currentUser);
      closeModal();
      renderApp();
      setView("app");
    } catch (error) {
      console.error("تعذر تسجيل حساب المدرّس المحلي.", error);
      message.textContent = error.message || "تعذر تسجيل الحساب في هذا المتصفح.";
    }
  }

  async function submitLocalStudentAuth(form) {
    const message = $("#auth-message");
    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const accounts = readStudentAccounts();

    try {
      if (authMode === "student-register") {
        const name = String(formData.get("name") || "").trim();
        const grade = String(formData.get("grade") || "");
        const phone = normalizePhone(formData.get("phone"));
        const guardianPhone = normalizePhone(formData.get("guardianPhone"));
        if (name.length < 2 || name.length > 80 || username.length < 3 || username.length > 40
            || !grade || password.length < 8) {
          message.textContent = "أكمل البيانات المطلوبة، واجعل اسم المستخدم 3 أحرف على الأقل وكلمة المرور 8 أحرف على الأقل.";
          return;
        }
        if (!validOptionalPhone(phone) || !validOptionalPhone(guardianPhone)) {
          message.textContent = "رقم الطالب ورقم ولي الأمر يجب أن يتكون كل منهما من 11 رقمًا.";
          return;
        }
        if (usernameExists(username)) {
          message.textContent = "اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.";
          return;
        }

        const id = uid();
        const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
        const account = {
          id,
          name,
          username,
          grade,
          phone,
          guardianPhone,
          salt,
          passwordHash: await hashTeacherPassword(password, salt),
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString()
        };
        const originalStudentAccounts = localStorage.getItem(STUDENT_ACCOUNTS_KEY);
        const originalStore = localStorage.getItem(STORAGE_KEY);
        accounts.push(account);
        store.students.push(localStudentUser(account));
        if (!saveStore() || !saveStudentAccounts(accounts)) {
          store.students = store.students.filter(student => student.id !== id);
          if (originalStore === null) localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, originalStore);
          if (originalStudentAccounts === null) localStorage.removeItem(STUDENT_ACCOUNTS_KEY);
          else localStorage.setItem(STUDENT_ACCOUNTS_KEY, originalStudentAccounts);
          return;
        }
        currentUser = localStudentUser(account);
        setLocalSession(currentUser);
        closeModal();
        renderApp();
        setView("app");
        showToast("تم إنشاء حساب الطالب وتفعيله.");
        return;
      }

      const account = accounts.find(item => normalizeUsername(item.username) === normalizeUsername(username));
      if (!account || await hashTeacherPassword(password, account.salt) !== account.passwordHash) {
        message.textContent = "اسم المستخدم أو كلمة المرور غير صحيحين.";
        return;
      }
      account.lastLoginAt = new Date().toISOString();
      if (!saveStudentAccounts(accounts)) return;
      const profile = store.students.find(student => student.id === account.id);
      if (profile) {
        profile.lastLoginAt = account.lastLoginAt;
        if (!saveStore()) return;
      }
      currentUser = localStudentUser(account);
      setLocalSession(currentUser);
      closeModal();
      renderApp();
      setView("app");
    } catch (error) {
      console.error("تعذر تسجيل حساب الطالب المحلي.", error);
      message.textContent = error.message || "تعذر تسجيل الحساب في هذا المتصفح.";
    }
  }

  function formatDateTime(value) {
    if (!value) return "لم يسجل دخولاً بعد";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "غير متاح";
    return new Intl.DateTimeFormat("ar-EG", {
      day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit"
    }).format(date);
  }

  function setView(view) {
    $("#home-view").classList.toggle("active", view === "home");
    $("#app-view").classList.toggle("active", view === "app");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyTheme(theme) {
    const selected = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = selected;
    const themeColor = $('meta[name="theme-color"]');
    if (themeColor) themeColor.content = selected === "light" ? "#f3f7fb" : "#07111f";
    $$("[data-theme-toggle]").forEach(button => {
      button.setAttribute("aria-label", `التبديل إلى الوضع ${selected === "dark" ? "النهاري" : "الليلي"}`);
      button.setAttribute("aria-pressed", String(selected === "light"));
      const icon = $(".theme-icon", button);
      const label = $(".theme-label", button);
      if (icon) icon.textContent = selected === "light" ? "☀" : "☾";
      if (label) label.textContent = selected === "light" ? "الوضع النهاري" : "الوضع الليلي";
    });
    try {
      localStorage.setItem(THEME_KEY, selected);
    } catch (error) {
      console.error("تعذر حفظ اختيار المظهر.", error);
    }
  }

  function openModal(mode = "student-login") {
    setAuthMode(mode);
    $("#auth-modal").classList.add("open");
    $("#auth-modal").setAttribute("aria-hidden", "false");
    $("#auth-message").textContent = "";
    const firstInput = $("#auth-fields input");
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  function closeModal() {
    $("#auth-modal").classList.remove("open");
    $("#auth-modal").setAttribute("aria-hidden", "true");
  }

  function setAuthMode(mode) {
    if (!["teacher-login", "student-login", "student-register"].includes(mode)) {
      mode = "student-login";
    }
    authMode = mode;
    $$(".auth-tabs button").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
    const titles = {
      "teacher-login": ["مساحة المدرس", "أهلاً يا مستر", "سجّل دخولك لإدارة المنصة والطلاب والاختبارات.", "دخول المدرس"],
      "student-register": ["حساب طالب جديد", "ابدأ رحلتك التعليمية", "أنشئ حسابك لمتابعة الاختبارات والدرجات.", "إنشاء الحساب"],
      "student-login": ["دخول الطالب", "أهلاً بيك", "سجّل دخولك عشان تكمّل رحلتك التعليمية.", "دخول الطالب"]
    }[mode];
    $("#auth-eyebrow").textContent = titles[0];
    $("#auth-title").textContent = titles[1];
    $("#auth-intro").textContent = titles[2];
    $("#auth-submit").innerHTML = `${titles[3]} <span>←</span>`;
    const isRegister = mode === "student-register";
    $("#demo-hint").textContent = "الحساب محفوظ على هذا المتصفح فقط، وليس مناسبًا لحماية موقع منشور أو للاستخدام من أجهزة متعددة.";
    const studentFields = mode === "student-register" ? `<div class="field"><label for="auth-name">الاسم بالكامل</label><input id="auth-name" name="name" autocomplete="name" required minlength="2" maxlength="80"></div>
      <div class="field"><label for="auth-grade">الصف الدراسي</label><select id="auth-grade" name="grade" required><option value="">اختر الصف</option><option>الأول الثانوي</option><option>الثاني الثانوي</option><option>الثالث الثانوي</option></select></div>
      <div class="form-grid"><div class="field"><label for="auth-phone">رقم الطالب (اختياري)</label><input id="auth-phone" name="phone" inputmode="numeric" maxlength="20" placeholder="01xxxxxxxxx"></div>
      <div class="field"><label for="auth-guardian-phone">رقم ولي الأمر (اختياري)</label><input id="auth-guardian-phone" name="guardianPhone" inputmode="numeric" maxlength="20" placeholder="01xxxxxxxxx"></div></div>` : "";
    $("#auth-fields").innerHTML = `${studentFields}<div class="field"><label for="auth-username">اسم المستخدم</label><input id="auth-username" name="username" autocomplete="username" placeholder="${isRegister ? "اختر اسم مستخدم خاصًا بك" : "اكتب اسم المستخدم"}" required minlength="3" maxlength="40"></div>
      <div class="field"><label for="auth-password">كلمة المرور</label><input id="auth-password" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" placeholder="اكتب كلمة المرور" required minlength="${mode === "student-register" ? 8 : 1}" maxlength="128"></div>`;
  }

  function submitAuth(event) {
    event.preventDefault();
    const message = $("#auth-message");
    message.textContent = "";
    if (authMode === "teacher-login") void submitLocalTeacherAuth(event.target);
    else void submitLocalStudentAuth(event.target);
  }

  const navigation = {
    teacher: [
      ["dashboard", "◫", "نظرة عامة"], ["students", "♙", "الطلاب والدرجات"],
      ["tests", "✎", "الاختبارات"], ["videos", "▶", "فيديوهات الشرح"]
    ],
    student: [
      ["dashboard", "◫", "نظرة عامة"], ["tests", "✎", "الاختبارات"], ["videos", "▶", "فيديوهات الشرح"],
      ["grades", "⌁", "درجاتي"], ["profile", "◎", "ملفي الشخصي"]
    ]
  };

  function renderApp(section = "dashboard") {
    if (!currentUser) return;
    const teacher = currentUser.role === "teacher";
    const allowedSections = teacher
      ? ["dashboard", "students", "tests", "videos"]
      : ["dashboard", "tests", "videos", "grades", "profile"];
    if (!allowedSections.includes(section)) section = "dashboard";
    $("#user-name").textContent = currentUser.name;
    $("#user-role").textContent = teacher ? `مدرس الفيزياء · ${TEACHER_NAME}` : currentUser.grade || "طالب";
    $("#user-avatar").textContent = teacher ? "أ" : (currentUser.name || "ط").slice(0, 1);
    $("#header-avatar").textContent = teacher ? "أ" : (currentUser.name || "ط").slice(0, 1);
    $("#today-date").textContent = new Intl.DateTimeFormat("ar-EG", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
    $("#app-nav").innerHTML = navigation[currentUser.role].map(([id, icon, label]) => `<a href="#" class="nav-item ${section === id ? "active" : ""}" data-section="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></a>`).join("");
    const labels = {
      dashboard: ["مساحتك التعليمية", teacher ? "لوحة تحكم المدرس" : "أهلاً بيك في أحمد بدر في الفيزياء"],
      students: ["متابعة طلابك", "الطلاب والدرجات"],
      tests: ["تدريب وقياس المستوى", "الاختبارات"],
      videos: ["شرح الفيزياء", "فيديوهات الشرح"],
      grades: ["تقدّمك الدراسي", "درجاتي"],
      profile: ["بياناتك المحفوظة", "ملفي الشخصي"]
    };
    $("#page-eyebrow").textContent = labels[section][0];
    $("#page-title").textContent = labels[section][1];
    const pages = {
      dashboard: teacher ? renderTeacherDashboard : renderStudentDashboard,
      students: renderStudents,
      tests: renderTests,
      videos: renderVideos,
      grades: renderGrades,
      profile: renderProfile
    };
    $("#dashboard-content").innerHTML = pages[section] ? pages[section]() : "";
    $("#dashboard-content").dataset.currentSection = section;
    if (teacher && section === "tests") addQuestionField();
  }

  function metric(label, value, note, icon) {
    return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`;
  }

  function renderTeacherDashboard() {
    const approved = store.students.filter(student => student.status === "approved").length;
    const scores = store.scores;
    const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score.percentage, 0) / scores.length) : 0;
    const recent = [...scores].reverse().slice(0, 5);
    return `<div class="welcome-banner"><div><div class="eyebrow">مساحة إدارة المنصة</div><h2>أهلاً أستاذ ${TEACHER_NAME} 👋</h2><p>من هنا تقدر تتابع طلابك وتدير محتوى أحمد بدر في الفيزياء.</p></div><button class="btn btn-primary btn-sm" data-section="tests">إدارة الاختبارات ←</button></div>
      <div class="metric-grid">${metric("إجمالي الطلاب", store.students.length, `${approved} حساب مفعّل`, "♙")}${metric("الحساب", "مدرّس", "حساب محلي لهذا المتصفح فقط", "♧")}${metric("الاختبارات", store.tests.length, "اختبار محفوظ على هذا الجهاز", "✎")}${metric("متوسط الدرجات", `${average}%`, `${scores.length} محاولة مكتملة`, "⌁")}</div>
      <div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h3>أحدث نتائج الطلاب</h3><p>آخر محاولات الاختبارات</p></div><button class="btn btn-outline btn-sm" data-section="students">كل الطلاب</button></div>${recent.length ? recent.map(score => {
        const student = store.students.find(item => item.id === score.studentId);
        return `<div class="list-row"><div class="row-icon">⌁</div><div class="row-copy"><b>${escapeHtml(student?.name || "طالب")}</b><small>${escapeHtml(score.testTitle)} · ${escapeHtml(score.createdAtLabel)}</small></div><span class="badge">${score.percentage}%</span></div>`;
      }).join("") : '<div class="empty-state"><div class="empty-icon">⌁</div>نتائج الطلاب هتظهر هنا بعد حل الاختبارات.</div>'}</section>
      <section class="panel"><div class="panel-heading"><div><h3>إجراءات سريعة</h3><p>إدارة محتوى المنصة</p></div></div><div class="list-row"><div class="row-icon">✎</div><div class="row-copy"><b>أنشئ اختبار جديد</b><small>أضف أسئلة واختيارات وحدد الإجابة</small></div><button class="btn btn-outline btn-sm" data-section="tests">إضافة</button></div><div class="list-row"><div class="row-icon">▶</div><div class="row-copy"><b>أضف فيديو شرح</b><small>شارك رابط الدرس مع طلابك</small></div><button class="btn btn-outline btn-sm" data-section="videos">إضافة</button></div></section></div>`;
  }

  function renderStudentDashboard() {
    const availableTests = testsForStudent(currentUser);
    const scores = store.scores.filter(score => score.studentId === currentUser.id);
    const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score.percentage, 0) / scores.length) : 0;
    return `<div class="welcome-banner"><div><div class="eyebrow">رحلتك التعليمية</div><h2>أهلاً ${escapeHtml(currentUser.name.split(" ")[0])} 👋</h2><p>حسابك مفعّل. كمّل مذاكرتك وخلي كل سؤال فرصة للتقدم.</p></div><button class="btn btn-primary btn-sm" data-section="tests">ابدأ اختبار ←</button></div>
      <div class="metric-grid">${metric("اختبارات متاحة لصفك", availableTests.length, "اختبر فهمك للمادة", "✎")}${metric("محاولاتي", scores.length, "اختبارات أكملتها", "↻")}${metric("متوسط درجاتي", `${average}%`, scores.length ? "استمر في التقدم" : "ابدأ أول اختبار", "⌁")}${metric("فيديوهات الشرح", store.videos.length, "دروس متاحة للمشاهدة", "▶")}</div>
      <div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h3>اختبارات مقترحة</h3><p>الاختبارات المتاحة لصفك، ولكل اختبار محاولة واحدة.</p></div><button class="btn btn-outline btn-sm" data-section="tests">كل الاختبارات</button></div>${availableTests.length ? availableTests.slice(0, 4).map(test => {
        const used = hasUsedTestAttempt(currentUser.id, test.id);
        return `<div class="list-row"><div class="row-icon">✎</div><div class="row-copy"><b>${escapeHtml(test.title)}</b><small>${escapeHtml(test.topic)} · ${test.questions.length} أسئلة</small></div>${used ? '<span class="badge">تمت المحاولة</span>' : `<button class="btn btn-primary btn-sm" data-start-test="${test.id}">ابدأ</button>`}</div>`;
      }).join("") : '<div class="empty-state"><div class="empty-icon">✎</div>لا توجد اختبارات متاحة لصفك حالياً.</div>'}</section>
      <section class="panel"><div class="panel-heading"><div><h3>آخر درجاتي</h3><p>نتائجك محفوظة في حسابك</p></div><button class="btn btn-outline btn-sm" data-section="grades">عرض الكل</button></div>${scores.length ? scores.slice(-4).reverse().map(score => `<div class="list-row"><div class="row-icon">⌁</div><div class="row-copy"><b>${escapeHtml(score.testTitle)}</b><small>${escapeHtml(score.createdAtLabel)}</small></div><span class="badge">${score.score}/${score.total}</span></div>`).join("") : '<div class="empty-state"><div class="empty-icon">⌁</div>حلّ اختبار عشان تتابع درجاتك هنا.</div>'}</section></div>`;
  }

  function renderStudents() {
    const students = store.students.filter(student => student.status === "approved");
    const selectedStudent = store.students.find(student => student.id === selectedStudentReportId);
    return `<div class="content-toolbar"><p>الطلاب المعتمدون، آخر دخول، وتقارير الدرجات والمستوى.</p><span class="badge">${students.length} طالب</span></div><section class="panel">${students.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>اسم الطالب</th><th>الصف</th><th>الاختبارات</th><th>المتوسط</th><th>آخر دخول</th><th>ولي الأمر</th><th>التقرير</th><th></th></tr></thead><tbody>${students.map(student => {
      const results = store.scores.filter(score => score.studentId === student.id);
      const avg = results.length ? Math.round(results.reduce((sum, score) => sum + score.percentage, 0) / results.length) : 0;
      return `<tr><td><b>${escapeHtml(student.name)}</b><small class="table-subtext">${escapeHtml(student.username)}</small></td><td>${escapeHtml(student.grade)}</td><td>${results.length}</td><td><span class="badge">${avg}%</span></td><td>${escapeHtml(formatDateTime(student.lastLoginAt))}</td><td>${escapeHtml(student.guardianPhone || "—")}</td><td><button class="btn btn-outline btn-sm" data-student-report="${student.id}">عرض التقرير</button></td><td><button class="btn btn-danger btn-sm" data-remove-student="${student.id}">حذف</button></td></tr>`;
    }).join("")}</tbody></table></div>` : '<div class="empty-state"><div class="empty-icon">♙</div>الطلاب المقبولون هيظهروا هنا.</div>'}</section>${selectedStudent ? renderStudentReport(selectedStudent) : ""}`;
  }

  function renderStudentReport(student) {
    const results = store.scores.filter(score => score.studentId === student.id)
      .slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const average = results.length
      ? Math.round(results.reduce((sum, result) => sum + result.percentage, 0) / results.length)
      : 0;
    const level = results.length === 0 ? "لم يؤدِ اختبارات بعد"
      : average >= 85 ? "ممتاز — مستوى متقدم"
        : average >= 70 ? "جيد جداً — أداء ثابت"
          : average >= 50 ? "متوسط — يحتاج متابعة"
            : "يحتاج دعم ومراجعة";
    return `<section class="panel student-report" id="student-report"><div class="panel-heading"><div><span class="eyebrow">تقرير الطالب</span><h3>${escapeHtml(student.name)}</h3><p>${escapeHtml(student.grade)} · اسم المستخدم ${escapeHtml(student.username)}</p></div><button class="btn btn-outline btn-sm" data-close-report>إغلاق التقرير</button></div>
      <div class="report-metrics">${metric("المستوى الدراسي", level, "حسب متوسط درجاته", "✦")}${metric("متوسط الدرجات", `${average}%`, `${results.length} اختبار مسجل`, "⌁")}${metric("آخر دخول", formatDateTime(student.lastLoginAt), "آخر نشاط مسجل على الحساب", "◷")}</div>
      <div class="report-contact"><span><b>رقم الطالب:</b> ${escapeHtml(student.phone || "غير مضاف")}</span><span><b>رقم ولي الأمر:</b> ${escapeHtml(student.guardianPhone || "غير مضاف")}</span></div>
      <div class="panel-heading report-history-heading"><div><h3>سجل الاختبارات والدرجات</h3><p>كل محاولة مسجلة لهذا الطالب.</p></div></div>
      ${results.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>الاختبار</th><th>الدرجة</th><th>النسبة</th><th>التقييم</th><th>تاريخ الحل</th></tr></thead><tbody>${results.map(result => `<tr><td><b>${escapeHtml(result.testTitle)}</b></td><td>${result.score} من ${result.total}</td><td><span class="badge ${result.percentage < 50 ? "rejected" : result.percentage < 70 ? "pending" : ""}">${result.percentage}%</span></td><td>${result.percentage >= 85 ? "ممتاز" : result.percentage >= 70 ? "جيد جداً" : result.percentage >= 50 ? "مقبول" : "يحتاج مراجعة"}</td><td>${escapeHtml(formatDateTime(result.createdAt))}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">لا توجد اختبارات مسجلة لهذا الطالب حتى الآن.</div>'}</section>`;
  }

  function renderTests() {
    if (currentUser.role === "student") {
      const availableTests = testsForStudent(currentUser);
      return `<div class="content-toolbar"><p>اختبارات صفك فقط. لكل اختبار محاولة واحدة تبدأ عند بدء الاختبار.</p><span class="badge">${availableTests.length} اختبار</span></div>${availableTests.length ? availableTests.map(test => {
        const attempts = store.scores.filter(score => score.studentId === currentUser.id && score.testId === test.id).length;
        const used = hasUsedTestAttempt(currentUser.id, test.id);
        const startedWithoutResult = used && attempts === 0;
        return `<article class="panel" style="margin-bottom:10px"><div class="panel-heading"><div><h3>${escapeHtml(test.title)}</h3><p>${escapeHtml(test.topic)} · ${test.questions.length} أسئلة</p></div><span class="badge">${used ? (startedWithoutResult ? "المحاولة مستخدمة" : "تمت المحاولة") : "متاح · محاولة واحدة"}</span></div><p class="muted" style="font-size:10px;margin-top:-6px">${escapeHtml(test.description || "اختبر معلوماتك في هذا الدرس.")}</p>${used ? '<button class="btn btn-outline btn-sm" type="button" disabled>لا توجد محاولات متبقية</button>' : `<button class="btn btn-primary btn-sm" data-start-test="${test.id}">ابدأ الاختبار ←</button>`}</article>`;
      }).join("") : '<section class="panel empty-state"><div class="empty-icon">✎</div>المدرس لسه ما أضافش اختبارات.</section>'}`;
    }
    return `<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h3>إنشاء اختبار جديد</h3><p>حدد الصف الدراسي المستهدف قبل إضافة الأسئلة.</p></div></div><form id="test-form"><div class="field"><label for="test-title">عنوان الاختبار</label><input id="test-title" name="title" placeholder="مثال: قوانين نيوتن" required></div><div class="form-grid"><div class="field"><label for="test-topic">الموضوع</label><input id="test-topic" name="topic" placeholder="الحركة" required></div><div class="field"><label for="test-grade">الصف الدراسي المستهدف</label><select id="test-grade" name="grade" required><option value="">اختر الصف الدراسي</option>${STUDENT_GRADES.map(grade => `<option value="${escapeHtml(grade)}">${escapeHtml(grade)}</option>`).join("")}<option value="${ALL_GRADES}">كل الصفوف</option></select></div></div><div class="field"><label for="test-desc">وصف قصير</label><input id="test-desc" name="description" placeholder="اختبار على الدرس الأول"></div><div id="test-questions"></div><div class="form-actions"><button type="button" class="btn btn-outline btn-sm" id="add-question">+ أضف سؤال</button><button type="submit" class="btn btn-primary btn-sm">حفظ الاختبار</button></div><div class="form-message" id="test-message"></div></form></section>
      <section class="panel"><div class="panel-heading"><div><h3>اختبارات المنصة</h3><p>الصف المستهدف ظاهر بجانب كل اختبار.</p></div><span class="badge">${store.tests.length}</span></div>${store.tests.length ? store.tests.map(test => `<div class="list-row"><div class="row-icon">✎</div><div class="row-copy"><b>${escapeHtml(test.title)}</b><small>${escapeHtml(test.grade === ALL_GRADES ? "كل الصفوف" : test.grade || "كل الصفوف (اختبار قديم)")} · ${escapeHtml(test.topic)} · ${test.questions.length} أسئلة</small></div><button class="btn btn-outline btn-sm" data-edit-test="${test.id}">تعديل</button><button class="btn btn-danger btn-sm" data-delete-test="${test.id}">حذف</button></div>`).join("") : '<div class="empty-state">لم يتم إنشاء اختبارات بعد.</div>'}</section></div>`;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? escapeHtml(url.href) : "#";
    } catch {
      return "#";
    }
  }

  function renderVideos() {
    const teacher = currentUser.role === "teacher";
    const form = teacher ? `<section class="panel" style="margin-bottom:15px"><div class="panel-heading"><div><h3>إضافة فيديو شرح</h3><p>أضف رابط الفيديو ليظهر للطلاب.</p></div></div><form id="video-form"><div class="form-grid"><div class="field"><label for="video-title">عنوان الدرس</label><input id="video-title" name="title" required placeholder="مثال: قوانين الحركة"></div><div class="field"><label for="video-topic">الوحدة أو الصف</label><input id="video-topic" name="topic" placeholder="الصف الأول الثانوي"></div></div><div class="field"><label for="video-url">رابط الفيديو (YouTube أو رابط مباشر)</label><input id="video-url" name="url" type="url" placeholder="https://..." required></div><div class="field"><label for="video-description">وصف (اختياري)</label><textarea id="video-description" name="description" placeholder="محتوى الدرس باختصار"></textarea></div><button class="btn btn-primary btn-sm" type="submit">نشر الفيديو</button></form></section>` : "";
    return `${form}<div class="content-toolbar"><p>${teacher ? "الفيديوهات المنشورة للطلاب." : "شاهد دروسك وارجع لها وقت ما تحب."}</p><span class="badge">${store.videos.length} فيديو</span></div>${store.videos.length ? `<div class="video-grid">${[...store.videos].reverse().map(video => `<article class="video-card"><div class="video-cover"><a class="play-button" href="${safeUrl(video.url)}" target="_blank" rel="noopener noreferrer" aria-label="مشاهدة ${escapeHtml(video.title)}">▶</a></div><div class="video-info"><h3>${escapeHtml(video.title)}</h3><p>${escapeHtml(video.topic || "شرح فيزياء")} · ${escapeHtml(video.description || "")}</p><a class="video-url" href="${safeUrl(video.url)}" target="_blank" rel="noopener noreferrer">شاهد الفيديو ↗</a>${teacher ? ` <button class="btn btn-outline btn-sm" data-edit-video="${video.id}">تعديل</button> <button class="btn btn-danger btn-sm" data-delete-video="${video.id}">حذف</button>` : ""}</div></article>`).join("")}</div>` : '<section class="panel empty-state"><div class="empty-icon">▶</div>فيديوهات الشرح هتظهر هنا لما المدرس يضيفها.</section>'}`;
  }

  function renderGrades() {
    if (currentUser.role === "teacher") return renderStudents();
    const scores = store.scores.filter(score => score.studentId === currentUser.id).slice().reverse();
    const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score.percentage, 0) / scores.length) : 0;
    return `<div class="metric-grid">${metric("الاختبارات المكتملة", scores.length, "كل محاولاتك", "✎")}${metric("متوسط درجاتي", `${average}%`, "استمر في المذاكرة", "⌁")}</div><section class="panel"><div class="panel-heading"><div><h3>سجل درجاتك</h3><p>نتائجك محفوظة تلقائياً في حسابك.</p></div></div>${scores.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>الاختبار</th><th>الدرجة</th><th>النسبة</th><th>التاريخ</th></tr></thead><tbody>${scores.map(score => `<tr><td><b>${escapeHtml(score.testTitle)}</b></td><td>${score.score} / ${score.total}</td><td><span class="badge ${score.percentage >= 70 ? "" : "pending"}">${score.percentage}%</span></td><td>${escapeHtml(score.createdAtLabel)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><div class="empty-icon">⌁</div>لسه مفيش درجات. حلّ اختبارك الأول!</div>'}</section>`;
  }

  function renderProfile() {
    return `<div class="profile-grid"><section class="panel"><div class="panel-heading"><div><h3>بيانات حسابك</h3><p>معلوماتك المسجلة في المنصة.</p></div></div><div class="list-row"><div class="row-icon">♙</div><div class="row-copy"><b>الاسم بالكامل</b><small>${escapeHtml(currentUser.name)}</small></div></div><div class="list-row"><div class="row-icon">◎</div><div class="row-copy"><b>اسم المستخدم</b><small>${escapeHtml(currentUser.username)}</small></div></div><div class="list-row"><div class="row-icon">⌂</div><div class="row-copy"><b>الصف الدراسي</b><small>${escapeHtml(currentUser.grade)}</small></div></div><div class="list-row"><div class="row-icon">☏</div><div class="row-copy"><b>رقم الطالب</b><small>${escapeHtml(currentUser.phone || "لم تتم إضافته")}</small></div></div><div class="list-row"><div class="row-icon">♧</div><div class="row-copy"><b>رقم ولي الأمر</b><small>${escapeHtml(currentUser.guardianPhone || "لم تتم إضافته")}</small></div></div></section><section class="panel"><div class="panel-heading"><div><h3>حالة الحساب</h3><p>يُفعّل حسابك تلقائيًا عند التسجيل.</p></div></div><div class="empty-state"><div class="empty-icon">✓</div><span class="badge">حسابك مفعّل</span><p>تُحفظ بياناتك ودرجاتك بأمان في حسابك.</p></div></section></div>`;
  }

  function addQuestionField() {
    if (currentUser?.role !== "teacher") return;
    const container = $("#test-questions");
    if (!container) return;
    const index = $$(".question-editor", container).length;
    const card = document.createElement("div");
    card.className = "question-editor question-card";
    card.innerHTML = `<h4>السؤال ${index + 1}</h4><div class="field"><label>نص السؤال</label><input name="question" required placeholder="اكتب السؤال هنا"></div><div class="form-grid">${[0, 1, 2, 3].map(i => `<div class="field"><label>اختيار ${String.fromCharCode(65 + i)}</label><input name="option" required placeholder="الإجابة ${i + 1}"></div>`).join("")}</div><div class="field"><label>صورة السؤال (اختياري)</label><input name="questionImage" type="file" accept="image/*"><div class="question-image-preview" hidden><img alt="معاينة صورة السؤال"><button type="button" class="btn btn-outline btn-sm" data-remove-question-image>إزالة الصورة</button></div><small class="question-image-message">اختر صورة بحجم لا يتجاوز 5 ميجابايت.</small></div><div class="field"><label>رقم الاختيار الصحيح (1 إلى 4)</label><select name="correct" required><option value="">اختر الإجابة</option><option value="0">الاختيار الأول</option><option value="1">الاختيار الثاني</option><option value="2">الاختيار الثالث</option><option value="3">الاختيار الرابع</option></select></div>`;
    questionImageState.set(card, { value: "" });
    container.append(card);
  }

  function processQuestionImage(file) {
    if (!file.type.startsWith("image/")) {
      return Promise.reject(new Error("اختر ملف صورة صالحًا."));
    }
    if (file.size > 5 * 1024 * 1024) {
      return Promise.reject(new Error("حجم الصورة يجب ألا يتجاوز 5 ميجابايت."));
    }
    if (typeof createImageBitmap !== "function") {
      return Promise.reject(new Error("متصفحك لا يدعم معالجة الصور. حدّث المتصفح وحاول مرة أخرى."));
    }
    return createImageBitmap(file).then(bitmap => {
      const maxDimension = 1280;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        throw new Error("تعذرت معالجة الصورة في هذا المتصفح.");
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL("image/jpeg", 0.82);
    });
  }

  function showQuestionImagePreview(card, image) {
    const preview = $(".question-image-preview", card);
    const imageElement = $("img", preview);
    preview.hidden = !image;
    if (image) imageElement.src = image;
    else imageElement.removeAttribute("src");
  }

  async function saveTest(event) {
    event.preventDefault();
    if (currentUser?.role !== "teacher") {
      showToast("إدارة الاختبارات متاحة لحساب المدرّس فقط.");
      return;
    }
    const form = event.target;
    const cards = $$(".question-editor", form);
    let questions;
    try {
      questions = await Promise.all(cards.map(async card => {
        const options = $$('input[name="option"]', card).map(input => input.value.trim());
        const correct = Number.parseInt($('select[name="correct"]', card).value, 10);
        const imageState = questionImageState.get(card) || { value: "" };
        if (imageState.pending) await imageState.pending;
        if (imageState.error) throw imageState.error;
        return {
          text: $('input[name="question"]', card).value.trim(),
          options,
          correct,
          image: imageState.value || ""
        };
      }));
    } catch (error) {
      $("#test-message").textContent = error.message || "تعذرت معالجة صورة السؤال.";
      return;
    }
    if (!questions.length) {
      $("#test-message").textContent = "أضف سؤالاً واحداً على الأقل قبل حفظ الاختبار.";
      return;
    }
    if (questions.some(question => !question.text || question.options.some(option => !option)
        || !Number.isInteger(question.correct) || question.correct < 0 || question.correct > 3)) {
      $("#test-message").textContent = "أكمل نص كل سؤال والاختيارات وحدد الإجابة الصحيحة.";
      return;
    }
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const topic = String(data.get("topic") || "").trim();
    const grade = String(data.get("grade") || "");
    if (!title || !topic || (!STUDENT_GRADES.includes(grade) && grade !== ALL_GRADES)) {
      $("#test-message").textContent = "اكتب عنوان الاختبار والموضوع، وحدد الصف الدراسي المستهدف.";
      return;
    }
    const testData = {
      title, topic, grade,
      description: String(data.get("description") || "").trim(), questions
    };
    const editId = form.dataset.editId;
    let previousTest;
    if (editId) {
      const existing = store.tests.find(test => test.id === editId);
      if (!existing) {
        $("#test-message").textContent = "الاختبار لم يعد موجوداً. حدّث الصفحة وحاول مرة أخرى.";
        return;
      }
      previousTest = { ...existing };
      Object.assign(existing, testData, { updatedAt: new Date().toISOString() });
    } else {
      store.tests.push({ id: uid(), ...testData, createdAt: new Date().toISOString() });
    }
    if (!saveStore()) {
      if (editId) Object.assign(store.tests.find(test => test.id === editId), previousTest);
      else store.tests.pop();
      return;
    }
    renderApp("tests");
    showToast(editId ? "تم تحديث الاختبار." : "تم نشر الاختبار للطلاب.");
  }

  function startTest(id) {
    if (currentUser.role !== "student") {
      showToast("الاختبارات متاحة لحسابات الطلاب فقط.");
      return;
    }
    if (!testsForStudent(currentUser).some(test => test.id === id)) {
      showToast("هذا الاختبار غير مخصص لصفك الدراسي.");
      return;
    }
    activeTest = store.tests.find(test => test.id === id);
    if (!activeTest || !activeTest.questions.length) return;
    if (hasUsedTestAttempt(currentUser.id, activeTest.id)) {
      activeTest = null;
      showToast("استخدمت محاولتك الوحيدة في هذا الاختبار.");
      renderApp("tests");
      return;
    }
    const attempt = { id: uid(), studentId: currentUser.id, testId: activeTest.id, startedAt: new Date().toISOString() };
    store.attempts.push(attempt);
    if (!saveStore()) {
      store.attempts = store.attempts.filter(item => item.id !== attempt.id);
      activeTest = null;
      return;
    }
    currentTestIndex = 0;
    answers = [];
    renderQuestion();
  }

  function renderQuestion() {
    if (!activeTest) return;
    const question = activeTest.questions[currentTestIndex];
    const progress = Math.round(((currentTestIndex + 1) / activeTest.questions.length) * 100);
    $("#page-title").textContent = activeTest.title;
    $("#page-eyebrow").textContent = `السؤال ${currentTestIndex + 1} من ${activeTest.questions.length}`;
    const questionImage = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(question.image || "")
      ? `<img class="test-question-image" src="${question.image}" alt="صورة توضيحية للسؤال">`
      : "";
    $("#dashboard-content").innerHTML = `<section class="panel"><div class="panel-heading"><div><h3>${escapeHtml(activeTest.title)}</h3><p>اختار إجابة واحدة لكل سؤال.</p></div><span class="badge">${currentTestIndex + 1} / ${activeTest.questions.length}</span></div><div class="quiz-progress"><span style="width:${progress}%"></span></div><form id="question-form"><div class="question-card">${questionImage}<h4>${escapeHtml(question.text)}</h4>${question.options.map((option, index) => `<label class="answer-option"><input type="radio" name="answer" value="${index}" required><span>${String.fromCharCode(65 + index)}. ${escapeHtml(option)}</span></label>`).join("")}</div><div class="form-message" id="question-message"></div><button class="btn btn-primary" type="submit">${currentTestIndex === activeTest.questions.length - 1 ? "إنهاء الاختبار" : "السؤال التالي"} ←</button> <button class="btn btn-outline" type="button" data-section="tests">إلغاء</button></form></section>`;
  }

  function submitAnswer(event) {
    event.preventDefault();
    const selected = $('input[name="answer"]:checked', event.target);
    if (!selected) {
      $("#question-message").textContent = "اختار إجابة عشان تكمل.";
      return;
    }
    answers[currentTestIndex] = Number(selected.value);
    if (currentTestIndex < activeTest.questions.length - 1) {
      currentTestIndex++;
      renderQuestion();
    } else {
      finishTest();
    }
  }

  async function finishTest() {
    const completedTest = activeTest;
    let score;
    let total;
    let percentage;
    score = completedTest.questions.reduce((sum, question, index) => sum + (answers[index] === question.correct ? 1 : 0), 0);
    total = completedTest.questions.length;
    percentage = Math.round((score / total) * 100);
    const now = new Date();
    const scoreRecord = {
      id: uid(), studentId: currentUser.id, testId: completedTest.id, testTitle: completedTest.title,
      score, total, percentage, createdAt: now.toISOString(), createdAtLabel: now.toLocaleDateString("ar-EG")
    };
    const attempt = store.attempts.find(item => item.studentId === currentUser.id && item.testId === completedTest.id);
    if (!attempt) {
      activeTest = null;
      showToast("تعذر تسجيل المحاولة. تواصل مع المدرّس.");
      renderApp("tests");
      return;
    }
    attempt.completedAt = now.toISOString();
    attempt.scoreId = scoreRecord.id;
    store.scores.push(scoreRecord);
    if (!saveStore()) {
      store.scores = store.scores.filter(item => item.id !== scoreRecord.id);
      delete attempt.completedAt;
      delete attempt.scoreId;
      return;
    }
    const testTitle = completedTest.title;
    activeTest = null;
    $("#page-eyebrow").textContent = "نتيجتك";
    $("#page-title").textContent = "خلصت الاختبار!";
    $("#dashboard-content").innerHTML = `<section class="panel result-box"><div class="eyebrow" style="justify-content:center">مجهودك يستاهل ✦</div><div class="result-score">${percentage}%</div><h2>${score === total ? "ممتاز! إجاباتك كلها صحيحة 👏" : score >= total / 2 ? "شغل حلو، كمّل تدريب 💪" : "بداية كويسة، راجع الدرس وجرب تاني 📚"}</h2><p>درجتك في ${escapeHtml(testTitle)}: ${score} من ${total}</p><button class="btn btn-primary" data-section="grades">عرض كل درجاتي ←</button> <button class="btn btn-outline" data-section="tests">رجوع للاختبارات</button></section>`;
    showToast("اتحفظت نتيجتك في سجل درجاتك.");
  }

  function editTest(id) {
    if (currentUser?.role !== "teacher") return;
    const test = store.tests.find(item => item.id === id);
    if (!test) return;
    renderApp("tests");
    const form = $("#test-form");
    $("#test-questions", form).replaceChildren();
    form.dataset.editId = test.id;
    $('input[name="title"]', form).value = test.title;
    $('input[name="topic"]', form).value = test.topic;
    $('select[name="grade"]', form).value = test.grade || ALL_GRADES;
    $('input[name="description"]', form).value = test.description || "";
    test.questions.forEach(question => {
      addQuestionField();
      const cards = $$(".question-editor", form);
      const card = cards[cards.length - 1];
      $('input[name="question"]', card).value = question.text;
      $$('input[name="option"]', card).forEach((input, index) => { input.value = question.options[index] || ""; });
      $('select[name="correct"]', card).value = String(question.correct);
      const image = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(question.image || "") ? question.image : "";
      questionImageState.set(card, { value: image });
      showQuestionImagePreview(card, image);
    });
    $('button[type="submit"]', form).textContent = "حفظ التعديلات";
    $("#test-title").focus();
  }

  function editVideo(id) {
    if (currentUser?.role !== "teacher") return;
    const video = store.videos.find(item => item.id === id);
    if (!video) return;
    renderApp("videos");
    const form = $("#video-form");
    form.dataset.editId = video.id;
    $('input[name="title"]', form).value = video.title;
    $('input[name="topic"]', form).value = video.topic || "";
    $('input[name="url"]', form).value = video.url;
    $('textarea[name="description"]', form).value = video.description || "";
    $('button[type="submit"]', form).textContent = "حفظ التعديلات";
    $("#video-title").focus();
  }

  async function handleClick(event) {
    const open = event.target.closest("[data-open-auth]");
    if (open) { event.preventDefault(); openModal(open.dataset.openAuth); return; }
    const go = event.target.closest("[data-go]");
    if (go) { event.preventDefault(); setView(go.dataset.go === "home" ? "home" : "app"); return; }
    const start = event.target.closest("[data-start-test]");
    if (start) { startTest(start.dataset.startTest); return; }
    const editTestButton = event.target.closest("[data-edit-test]");
    if (editTestButton && currentUser?.role === "teacher") { editTest(editTestButton.dataset.editTest); return; }
    const editVideoButton = event.target.closest("[data-edit-video]");
    if (editVideoButton && currentUser?.role === "teacher") { editVideo(editVideoButton.dataset.editVideo); return; }
    const studentReport = event.target.closest("[data-student-report]");
    if (studentReport && currentUser.role === "teacher") {
      selectedStudentReportId = studentReport.dataset.studentReport;
      renderApp($("#dashboard-content").dataset.currentSection || "students");
      $("#student-report")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (event.target.closest("[data-close-report]")) {
      selectedStudentReportId = null;
      renderApp($("#dashboard-content").dataset.currentSection || "students");
      return;
    }
    const removeStudent = event.target.closest("[data-remove-student]");
    if (removeStudent && currentUser?.role === "teacher" && confirm("هل أنت متأكد من حذف حساب الطالب وبياناته ودرجاته؟")) {
      const id = removeStudent.dataset.removeStudent;
      const previousStudents = store.students;
      const previousScores = store.scores;
      const previousAttempts = store.attempts;
      const previousAccounts = readStudentAccounts();
      store.students = store.students.filter(student => student.id !== id);
      store.scores = store.scores.filter(score => score.studentId !== id);
      store.attempts = store.attempts.filter(attempt => attempt.studentId !== id);
      if (saveStore()) {
        const remainingAccounts = previousAccounts.filter(account => account.id !== id);
        if (!saveStudentAccounts(remainingAccounts)) {
          store.students = previousStudents;
          store.scores = previousScores;
          store.attempts = previousAttempts;
          saveStore();
          return;
        }
        renderApp("students");
        showToast("تم حذف بيانات الطالب.");
      } else {
        store.students = previousStudents;
        store.scores = previousScores;
        store.attempts = previousAttempts;
      }
      return;
    }
    const deleteTest = event.target.closest("[data-delete-test]");
    if (deleteTest && currentUser?.role === "teacher" && confirm("حذف الاختبار؟ سيتم الاحتفاظ بالدرجات السابقة.")) {
      store.tests = store.tests.filter(test => test.id !== deleteTest.dataset.deleteTest);
      if (saveStore()) { renderApp("tests"); showToast("تم حذف الاختبار."); }
      return;
    }
    const deleteVideo = event.target.closest("[data-delete-video]");
    if (deleteVideo && currentUser?.role === "teacher" && confirm("حذف هذا الفيديو من المنصة؟")) {
      store.videos = store.videos.filter(video => video.id !== deleteVideo.dataset.deleteVideo);
      if (saveStore()) { renderApp("videos"); showToast("تم حذف الفيديو."); }
      return;
    }
    const section = event.target.closest("[data-section]");
    if (section && currentUser) {
      event.preventDefault();
      activeTest = null;
      renderApp(section.dataset.section);
    }
  }

  async function handleSubmit(event) {
    if (event.target.id === "auth-form") { submitAuth(event); return; }
    if (event.target.id === "test-form") { saveTest(event); return; }
    if (event.target.id === "question-form") { submitAnswer(event); return; }
    if (event.target.id === "video-form") {
      event.preventDefault();
      if (currentUser?.role !== "teacher") {
        showToast("إدارة الفيديوهات متاحة لحساب المدرّس فقط.");
        return;
      }
      const data = new FormData(event.target);
      const video = {
        id: uid(), title: String(data.get("title")).trim(), topic: String(data.get("topic") || "").trim(),
        url: String(data.get("url") || "").trim(), description: String(data.get("description") || "").trim()
      };
      if (!safeUrl(video.url) || safeUrl(video.url) === "#") {
        showToast("أدخل رابط فيديو يبدأ بـ http:// أو https://.");
        return;
      }
      const editId = event.target.dataset.editId;
      if (editId) {
        const existing = store.videos.find(item => item.id === editId);
        if (!existing) { showToast("الفيديو لم يعد موجوداً. حدّث الصفحة وحاول مرة أخرى."); return; }
        Object.assign(existing, video, { id: editId });
      } else {
        store.videos.push(video);
      }
      if (saveStore()) { renderApp("videos"); showToast(editId ? "تم تحديث الفيديو." : "تم نشر الفيديو للطلاب."); }
    }
  }

  $("#auth-modal").addEventListener("click", event => {
    if (event.target === $("#auth-modal") || event.target.closest(".modal-close")) closeModal();
    const tab = event.target.closest("[data-auth-mode]");
    if (tab) setAuthMode(tab.dataset.authMode);
  });
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("click", event => {
    if (event.target.closest("[data-theme-toggle]")) {
      applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
      return;
    }
    const removeQuestionImage = event.target.closest("[data-remove-question-image]");
    if (removeQuestionImage) {
      const card = removeQuestionImage.closest(".question-editor");
      const state = questionImageState.get(card) || {};
      state.value = "";
      state.pending = null;
      state.error = null;
      questionImageState.set(card, state);
      $('input[name="questionImage"]', card).value = "";
      $(".question-image-message", card).textContent = "اختر صورة بحجم لا يتجاوز 5 ميجابايت.";
      showQuestionImagePreview(card, "");
      return;
    }
    if (event.target.closest("#add-question")) addQuestionField();
  });
  document.addEventListener("change", event => {
    if (event.target.matches('input[name="questionImage"]')) {
      const input = event.target;
      const card = input.closest(".question-editor");
      const state = questionImageState.get(card) || { value: "" };
      const file = input.files[0];
      if (!file) return;
      state.error = null;
      const pending = processQuestionImage(file);
      state.pending = pending;
      questionImageState.set(card, state);
      $(".question-image-message", card).textContent = "جارٍ تجهيز الصورة...";
      pending.then(image => {
        if (questionImageState.get(card) !== state || state.pending !== pending) return;
        state.value = image;
        state.pending = null;
        $(".question-image-message", card).textContent = "تم تجهيز الصورة.";
        showQuestionImagePreview(card, image);
      }, error => {
        if (questionImageState.get(card) !== state || state.pending !== pending) return;
        state.pending = null;
        state.error = error;
        input.value = "";
        $(".question-image-message", card).textContent = error.message || "تعذرت معالجة الصورة.";
        showQuestionImagePreview(card, state.value || "");
      });
    }
  });
  async function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("madar-teacher-session-v1");
    currentUser = null;
    activeTest = null;
    setView("home");
    showToast("تم تسجيل الخروج.");
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-logout]")) void logout();
  });

  async function initialize() {
    try {
      applyTheme(localStorage.getItem(THEME_KEY) || "dark");
    } catch (error) {
      console.error("تعذر استعادة اختيار المظهر.", error);
      applyTheme("dark");
    }
    try {
      let removedPasswords = false;
      store.students.forEach(student => {
        if (Object.hasOwn(student, "password")) {
          delete student.password;
          removedPasswords = true;
        }
      });
      if (removedPasswords) saveStore();
    } catch (error) {
      console.error("تعذر تنظيف بيانات الدخول المحلية القديمة.", error);
      showToast("تعذر تنظيف بيانات الدخول القديمة من هذا المتصفح.");
    }
    let account = null;
    try {
      account = await ensureTeacherAccount();
    } catch (error) {
      console.error("تعذر تجهيز حساب المدرّس المحلي.", error);
      showToast(error.message || "تعذر تجهيز حساب المدرّس على هذا المتصفح.");
    }
    setAccountStatus(account
      ? "حساب المدرّس والطلاب محلي على هذا المتصفح فقط"
      : "التسجيل متاح للطلاب؛ الحسابات محلية على هذا المتصفح فقط");
    let session = null;
    try {
      const savedSession = sessionStorage.getItem(SESSION_KEY);
      session = savedSession ? JSON.parse(savedSession) : null;
    } catch (error) {
      console.error("تعذر استعادة جلسة الحساب المحلي.", error);
      sessionStorage.removeItem(SESSION_KEY);
    }
    if (!session && sessionStorage.getItem("madar-teacher-session-v1") === "1" && account) {
      session = { id: "local-teacher", role: "teacher" };
      setLocalSession(localTeacherUser(account));
    }
    sessionStorage.removeItem("madar-teacher-session-v1");
    if (session?.role === "teacher" && session.id === "local-teacher" && account) {
      currentUser = localTeacherUser(account);
    } else if (session?.role === "student") {
      const studentAccount = readStudentAccounts().find(item => item.id === session.id);
      if (studentAccount) currentUser = localStudentUser(studentAccount);
    }
    if (currentUser) {
      renderApp();
      setView("app");
    }
  }
  void initialize();
})();
