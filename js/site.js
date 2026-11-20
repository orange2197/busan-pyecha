/* =========================================================
   부산폐차장 (주)성우모터스 - 사이트 동작 + 관리자 모드
   관리자 모드: 주소 끝에 #admin 을 붙여 접속 (예: https://내도메인.com/#admin)
   ========================================================= */
(function () {
  'use strict';
  var CFG = window.FIREBASE_CONFIG || {};
  var HAS_FB = !!(CFG && CFG.apiKey && CFG.projectId);
  var FB_VER = '10.12.2';

  var S = {
    phone: window.DEFAULT_PHONE || '010-2214-2287',
    reviews: (window.DEFAULT_REVIEWS || []).slice(0, 8),
    content: {},      // 글 수정 내용 { key: html }
    images: {},       // 사진 교체 { key: imageDocId }
    imgCache: {},     // imageDocId -> dataURL
    page: 'home', rvAll: false, open: {}
  };
  var ORIG = {};      // 원래 글 (원래대로 되돌리기용)
  var ORIG_IMG = {};
  var db = null, auth = null;

  var PAGE_IF = { home: 'isHome', greet: 'isGreet', process: 'isProcess', types: 'isTypes', docs: 'isDocs', apply: 'isApply', estimate: 'isEstimate', reviews: 'isReviews' };
  var TAG_COLOR = { '조기폐차': '#1E9E3E', '압류폐차': '#E2570A', '일반폐차': '#1E6FE8', '법인폐차': '#5B3CC4', '상속폐차': '#C21858' };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function digits() { return String(S.phone).replace(/[^0-9]/g, ''); }
  function smsLink(body) {
    var sep = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? '&' : '?';
    return 'sms:' + digits() + sep + 'body=' + encodeURIComponent(body);
  }
  function loadScript(src) {
    return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }

  /* ---------------- 전화번호 ---------------- */
  function applyPhone() {
    $$('.js-phone').forEach(function (el) { el.textContent = S.phone; });
    $$('a.js-tel').forEach(function (a) { a.href = 'tel:' + digits(); a.setAttribute('aria-label', '전화 걸기 ' + S.phone); });
    $$('[data-sms="quick"]').forEach(function (a) { a.href = smsLink('[문자견적문의]\n차종:\n차량번호:\n운행여부:\n차량위치:'); });
  }

  /* ---------------- 페이지 이동 ---------------- */
  function showPage(p, anchor) {
    if (!PAGE_IF[p]) p = 'home';
    S.page = p;
    Object.keys(PAGE_IF).forEach(function (k) {
      var el = $('[data-if="' + PAGE_IF[k] + '"]'); if (el) el.hidden = (k !== p);
    });
    $$('nav [data-go]').forEach(function (b) {
      var on = b.getAttribute('data-go') === p;
      b.style.background = on ? '#0B2A5B' : 'transparent'; b.style.color = on ? '#FFE14D' : '#0B2A5B';
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    try { history.replaceState(null, '', p === 'home' ? location.pathname + location.search : '#' + p); } catch (e) {}
    var jump = function () {
      var el = anchor && document.getElementById(anchor);
      if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
    };
    jump(); setTimeout(jump, 60);
  }

  /* ---------------- 신청/견적 폼 ---------------- */
  var FORMS = {
    ap: { sec: 'isApply', title: '[폐차신청]', req: [['ap-phone', '연락처'], ['ap-model', '차종'], ['ap-plate', '차량번호']],
      fields: [['연락처', 'ap-phone'], ['차종', 'ap-model'], ['차량번호', 'ap-plate'], ['차량위치', 'ap-loc']], cond: 'ap-cond' },
    es: { sec: 'isEstimate', title: '[온라인견적]', req: [['es-model', '차종'], ['es-plate', '차량번호'], ['es-phone', '연락처']],
      fields: [['차종', 'es-model'], ['차량번호', 'es-plate'], ['연락처', 'es-phone'], ['차량위치', 'es-region']], cond: 'es-cond' }
  };
  function submitForm(id, link, ev) {
    var f = FORMS[id], sec = $('[data-if="' + f.sec + '"]');
    var val = function (i) { var el = document.getElementById(i); return el ? el.value.trim() : ''; };
    var miss = f.req.filter(function (r) { return !val(r[0]); }).map(function (r) { return r[1]; });
    var agree = $('input[type=checkbox]', sec);
    var done = $('[data-if="' + id + 'Done"]');
    var firstMiss = f.req.filter(function (r) { return !val(r[0]); })[0];
    var target = firstMiss ? document.getElementById(firstMiss[0]) : (agree && !agree.checked ? agree : null);
    if (target) {
      ev.preventDefault();
      var row = target.closest('label') || target.parentElement;
      row.style.transition = 'box-shadow .2s'; row.style.boxShadow = '0 0 0 3px #FFC400';
      setTimeout(function () { row.style.boxShadow = ''; }, 1800);
      try { target.scrollIntoView({ block: 'center' }); } catch (e) {}
      if (target.type !== 'checkbox') target.focus();
      if (done) done.hidden = true; return;
    }
    var cond = $('input[name="' + f.cond + '"]:checked');
    var body = f.title + '\n' + f.fields.map(function (x) { return x[0] + ': ' + (val(x[1]) || '-'); }).join('\n') + '\n차량상태: ' + (cond ? cond.value : '-');
    link.href = smsLink(body);
    if (done) done.hidden = false;
  }

  /* ---------------- 후기 ---------------- */
  function photoSrc(r) {
    if (r._newPhoto) return r._newPhoto;
    if (!r.photo) return '';
    if (r.photo.indexOf('fs:') === 0) return S.imgCache[r.photo.slice(3)] || '';
    return r.photo;
  }
  var CAM = '<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
  function photoBox(r, minH) {
    var src = photoSrc(r);
    var inner = src
      ? '<img src="' + esc(src) + '" alt="' + esc(r.car) + ' 폐차 사진" loading="lazy" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover">'
      : '<div role="img" aria-label="' + esc(r.car) + ' 차량 사진 자리" style="position: absolute; inset: 0; background: repeating-linear-gradient(45deg, #EEF5FF 0 12px, #F8FBFF 12px 24px); border-left: 2px dashed #A9CBF5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px; box-sizing: border-box; text-align: center; color: #4A6FA5; font-size: 13px; font-weight: 800">' + CAM + '<span>차량 사진</span></div>';
    return '<div style="flex: 0 0 38%; position: relative; min-height: ' + minH + 'px">' + inner + '</div>';
  }
  function badges(r, gap) {
    return '<span style="background: ' + (TAG_COLOR[r.tag] || '#1E6FE8') + '; color: #FFFFFF; font-weight: 900; font-size: 12.5px; padding: 3px 10px; border-radius: 999px">' + esc(r.tag) + '</span>' +
      (r.example ? '<span style="font-size: 11.5px; font-weight: 700; color: #8A5A00; background: #FFF4C7; padding: 2px 7px; border-radius: 6px">작성 예시</span>' : '');
  }
  function renderReviews() {
    var list = S.reviews.slice(0, 8);
    var home = $('#rv-home');
    if (home) home.innerHTML = list.slice(0, 3).map(function (r) {
      return '<article style="background: #FFFFFF; border-radius: 24px; overflow: hidden; box-shadow: 0 6px 20px rgba(11,42,91,0.07); display: flex; align-items: stretch">' +
        '<div style="flex: 1 1 0; min-width: 0; padding: 16px 14px 18px 18px"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px">' + badges(r) + '</div>' +
        '<h3 style="margin: 8px 0 0; font-size: 18px; font-weight: 900; line-height: 1.35">' + esc(r.car) + '</h3>' +
        '<p style="margin: 0 0 6px; font-size: 13px; color: #4A5D80">' + esc(r.loc) + '</p>' +
        '<p style="margin: 0 0 3px; font-size: 14.5px; font-weight: 900; line-height: 1.4; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden">' + esc(r.title) + '</p>' +
        '<p style="margin: 0; font-size: 13.5px; line-height: 1.55; color: #3A4E73; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden">' + esc(r.text) + '</p></div>' +
        photoBox(r, 170) + '</article>';
    }).join('');
    var box = $('#rv-list');
    if (box) {
      var shown = S.rvAll ? list : list.slice(0, 6);
      box.innerHTML = shown.map(function (r, i) {
        var open = !!S.open[i];
        var cls = (!S.rvAll && i >= 4) ? ' class="rv-x"' : '';
        return '<article' + cls + ' style="background: #FFFFFF; border-radius: 24px; overflow: hidden; box-shadow: 0 8px 24px rgba(11,42,91,0.08); display: flex; align-items: stretch">' +
          '<button type="button" data-rv="' + i + '" aria-expanded="' + open + '" style="flex: 1 1 0; min-width: 0; border: 0; background: transparent; text-align: left; cursor: pointer; font-family: inherit; color: #0B2A5B; padding: 16px 12px 16px 16px; display: flex; flex-direction: column; gap: 5px">' +
          '<span style="display: flex; flex-wrap: wrap; gap: 5px; align-items: center">' + badges(r) + '</span>' +
          '<span style="display: block; font-size: 12.5px; font-weight: 700; color: #4A5D80">' + esc(r.car) + ' · ' + esc(r.loc) + '</span>' +
          '<span style="display: block; margin-top: 2px; font-size: 16px; font-weight: 900; line-height: 1.4">' + esc(r.title) + '</span>' +
          (open
            ? '<span style="display: block; font-size: 13.5px; line-height: 1.6; color: #3A4E73; white-space: pre-line">' + esc(r.text) + '</span><span style="display: block; margin-top: 2px; font-size: 12.5px; font-weight: 700; color: #4A5D80">' + esc(r.who) + '</span><span style="display: block; margin-top: 2px; font-size: 13px; font-weight: 900; color: #E2570A">접기 ▲</span>'
            : '<span style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 13.5px; line-height: 1.6; color: #3A4E73">' + esc(r.text) + '</span><span style="display: block; margin-top: 2px; font-size: 13px; font-weight: 900; color: #E2570A">후기 전체 보기 ▼</span>') +
          '</button>' + photoBox(r, 150) + '</article>';
      }).join('');
      var more = $('[data-if="rvHasMore"]');
      if (more) {
        more.hidden = list.length <= 4;
        var wrap = more.firstElementChild, btn = $('[data-act="rvall"]', more);
        if (wrap) wrap.className = (S.rvAll || list.length > 6) ? '' : 'rv-more-m';
        if (btn) btn.textContent = S.rvAll ? '접기 ▲' : '후기 더보기 ▼';
      }
    }
  }

  /* ---------------- 저장된 수정 내용 적용 ---------------- */
  function sanitize(h) {
    var d = new DOMParser().parseFromString('<div>' + h + '</div>', 'text/html').body.firstChild;
    $$('script,iframe,object,embed,style,link,meta', d).forEach(function (n) { n.remove(); });
    $$('*', d).forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value) || a.name === 'contenteditable') n.removeAttribute(a.name);
      });
    });
    return d.innerHTML;
  }
  function applyNav() {
    $$('nav [data-go]').forEach(function (b) {
      var k = 'nav:' + b.getAttribute('data-go');
      if (!b.hasAttribute('data-orig')) b.setAttribute('data-orig', b.textContent);
      b.textContent = S.content[k] || b.getAttribute('data-orig');
    });
  }
  function applyContent() {
    applyNav();
    Object.keys(S.content).forEach(function (k) {
      if (k.indexOf('nav:') === 0) return;
      var el = $('[data-e="' + k + '"]'); if (el && S.content[k] != null) el.innerHTML = sanitize(S.content[k]);
    });
    Object.keys(S.images).forEach(function (k) {
      var el = $('[data-img="' + k + '"]'), src = S.imgCache[S.images[k]]; if (el && src) el.src = src;
    });
    applyPhone();
  }

  /* ---------------- Firebase ---------------- */
  function initFirebase(withAuth) {
    if (!HAS_FB) return Promise.reject(new Error('firebase-config.js 설정이 비어 있습니다.'));
    var base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
    var p = window.firebase ? Promise.resolve() : loadScript(base + 'firebase-app-compat.js').then(function () { return loadScript(base + 'firebase-firestore-compat.js'); });
    return p.then(function () {
      if (!firebase.apps.length) firebase.initializeApp(CFG);
      db = firebase.firestore();
      if (withAuth && !auth) return (firebase.auth ? Promise.resolve() : loadScript(base + 'firebase-auth-compat.js')).then(function () { auth = firebase.auth(); });
    });
  }
  function fetchImages(ids) {
    var need = ids.filter(function (id) { return id && !S.imgCache[id]; });
    return Promise.all(need.map(function (id) {
      return db.collection('images').doc(id).get().then(function (d) { if (d.exists) S.imgCache[id] = d.data().data; }).catch(function () {});
    }));
  }
  function loadSaved() {
    return initFirebase(false).then(function () { return db.collection('site').doc('main').get(); }).then(function (d) {
      if (!d.exists) return;
      var x = d.data();
      if (x.phone) S.phone = x.phone;
      if (x.content) S.content = x.content;
      if (x.images) S.images = x.images;
      if (Array.isArray(x.reviews) && x.reviews.length) S.reviews = x.reviews.slice(0, 8);
      var ids = Object.keys(S.images).map(function (k) { return S.images[k]; })
        .concat(S.reviews.filter(function (r) { return r.photo && r.photo.indexOf('fs:') === 0; }).map(function (r) { return r.photo.slice(3); }));
      return fetchImages(ids);
    }).then(function () { applyContent(); renderReviews(); });
  }

  /* ---------------- 시작 ---------------- */
  function boot() {
    $$('[data-e]').forEach(function (el) { ORIG[el.getAttribute('data-e')] = el.innerHTML; });
    $$('[data-img]').forEach(function (el) { ORIG_IMG[el.getAttribute('data-img')] = el.getAttribute('src'); });
    applyNav(); applyPhone(); renderReviews();
    var h = (location.hash || '').slice(1);
    if (PAGE_IF[h]) showPage(h);
    if (HAS_FB) loadSaved().catch(function (e) { console.warn('저장된 내용 불러오기 실패', e); });
    if (h === 'admin' || /[?&]admin\b/.test(location.search)) startAdmin();
    window.addEventListener('hashchange', function () { if (location.hash === '#admin') startAdmin(); });

    document.addEventListener('click', function (e) {
      var t = e.target;
      var go = t.closest('[data-go]');
      if (go) { e.preventDefault(); showPage(go.getAttribute('data-go'), go.getAttribute('data-anchor')); return; }
      var sub = t.closest('[data-submit]');
      if (sub) { submitForm(sub.getAttribute('data-submit'), sub, e); return; }
      var rv = t.closest('[data-rv]');
      if (rv) { var i = +rv.getAttribute('data-rv'); S.open[i] = !S.open[i]; renderReviews(); return; }
      if (t.closest('[data-act="rvall"]')) { S.rvAll = !S.rvAll; renderReviews(); return; }
    });
    $$('form[data-nosubmit]').forEach(function (f) { f.addEventListener('submit', function (e) { e.preventDefault(); }); });
  }

  /* =========================================================
     관리자 모드
     ========================================================= */
  var A = { on: false, editing: false, dirtyText: {}, dirtyImg: {}, dirtyPhone: false, dirtyReviews: false, dirtyNav: false };

  function modal(html) {
    var m = document.createElement('div'); m.className = 'adm-modal';
    m.innerHTML = '<div class="adm-box" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(m); return m;
  }
  function msg(t) { var el = $('#adm-msg'); if (el) el.textContent = t; }
  function isDirty() { return A.dirtyPhone || A.dirtyReviews || A.dirtyNav || Object.keys(A.dirtyText).length || Object.keys(A.dirtyImg).length; }

  function startAdmin() {
    if (A.on) return;
    if (!HAS_FB) { alertBox('관리자 모드를 쓰려면 먼저 firebase-config.js 파일에 Firebase 설정을 넣어야 합니다. (설치 안내서 참고)'); return; }
    A.on = true;
    initFirebase(true).then(function () {
      auth.onAuthStateChanged(function (u) { if (u) buildBar(u); else loginBox(); });
    }).catch(function (e) { A.on = false; alertBox('Firebase 연결 실패: ' + e.message); });
  }
  function alertBox(t) {
    var m = modal('<h2>안내</h2><p style="font-size:15px;line-height:1.6">' + esc(t) + '</p><div class="adm-row"><button class="adm-btn primary" type="button">확인</button></div>');
    $('button', m).onclick = function () { m.remove(); };
  }
  function loginBox() {
    if ($('#adm-login')) return;
    var m = modal('<h2 id="adm-login">관리자 로그인</h2><form><label for="adm-em">이메일</label><input id="adm-em" type="email" autocomplete="username" required>' +
      '<label for="adm-pw">비밀번호</label><input id="adm-pw" type="password" autocomplete="current-password" required><div class="adm-err" id="adm-lerr"></div>' +
      '<div class="adm-row"><button class="adm-btn" type="button" data-x>취소</button><button class="adm-btn primary" type="submit">로그인</button></div></form>');
    $('[data-x]', m).onclick = function () { m.remove(); A.on = false; try { history.replaceState(null, '', location.pathname); } catch (e) {} };
    $('form', m).onsubmit = function (e) {
      e.preventDefault();
      auth.signInWithEmailAndPassword($('#adm-em').value.trim(), $('#adm-pw').value).then(function () { m.remove(); })
        .catch(function () { $('#adm-lerr').textContent = '이메일 또는 비밀번호가 맞지 않습니다.'; });
    };
  }
  function buildBar(u) {
    if ($('#adm-bar')) return;
    var bar = document.createElement('div'); bar.id = 'adm-bar';
    bar.innerHTML = '<b>관리자</b><button type="button" data-a="edit">✎ 글·사진 수정</button><button type="button" data-a="phone">전화번호</button><button type="button" data-a="nav">메뉴 이름</button>' +
      '<button type="button" data-a="reviews">후기 관리</button><button type="button" data-a="reset">선택한 글 원래대로</button>' +
      '<button type="button" class="save" data-a="save">저장하기</button><button type="button" data-a="out">로그아웃</button>' +
      '<span class="msg" id="adm-msg">' + esc(u.email) + ' 로그인됨 · "글·사진 수정"을 누르면 화면의 글을 바로 고칠 수 있어요.</span>';
    document.body.appendChild(bar);
    document.body.style.paddingTop = (bar.offsetHeight + 16) + 'px';
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'edit') toggleEdit(b);
      if (a === 'phone') phoneBox();
      if (a === 'nav') navBox();
      if (a === 'reviews') reviewsBox();
      if (a === 'reset') resetFocused();
      if (a === 'save') saveAll();
      if (a === 'out') { if (isDirty() && !confirm('저장하지 않은 수정 내용이 있습니다. 그래도 나갈까요?')) return; auth.signOut().then(function () { location.href = location.pathname; }); }
    });
    window.addEventListener('beforeunload', function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('click', editClickGuard, true);
    document.addEventListener('paste', function (e) {
      if (!A.editing || !e.target.closest('[data-e]')) return;
      e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    document.addEventListener('keydown', function (e) {
      if (A.editing && e.key === 'Enter' && e.target.closest && e.target.closest('[data-e]')) { e.preventDefault(); document.execCommand('insertLineBreak'); }
    });
    document.addEventListener('input', function (e) {
      var el = e.target.closest && e.target.closest('[data-e]'); if (!el || !A.editing) return;
      var k = el.getAttribute('data-e'); A.dirtyText[k] = true; el.classList.add('changed'); msg('수정 중… 다 고치신 뒤 "저장하기"를 눌러주세요.');
    });
  }
  function toggleEdit(btn) {
    A.editing = !A.editing;
    document.body.classList.toggle('edit-on', A.editing);
    btn.classList.toggle('on', A.editing);
    btn.textContent = A.editing ? '✓ 수정 끝내기' : '✎ 글·사진 수정';
    $$('[data-e]').forEach(function (el) { if (A.editing) el.setAttribute('contenteditable', 'true'); else el.removeAttribute('contenteditable'); });
    $$('[data-e] .js-phone').forEach(function (el) { if (A.editing) el.setAttribute('contenteditable', 'false'); else el.removeAttribute('contenteditable'); });
    msg(A.editing ? '주황 점선 글은 눌러서 바로 고치고, 초록 점선 사진은 눌러서 바꾸세요. 위 메뉴(홈·인사말…)로 다른 페이지도 수정할 수 있어요.' : '수정 모드를 껐어요. 바뀐 내용은 "저장하기"를 눌러야 반영돼요.');
  }
  function editClickGuard(e) {
    if (!A.editing || e.target.closest('#adm-bar') || e.target.closest('.adm-modal') || e.target.closest('nav')) return;
    var img = e.target.closest('[data-img]');
    if (img && !e.target.closest('[data-e]')) { e.preventDefault(); e.stopPropagation(); pickImage(function (data) { img.src = data; img.classList.add('changed'); A.dirtyImg[img.getAttribute('data-img')] = data; msg('사진을 바꿨어요. "저장하기"를 눌러야 반영돼요.'); }); return; }
    if (e.target.closest('[data-e]')) { if (e.target.closest('a,button,label')) { e.preventDefault(); e.stopPropagation(); } }
  }
  function resetFocused() {
    var sel = window.getSelection(), n = sel && sel.anchorNode, el = n && (n.nodeType === 1 ? n : n.parentElement);
    el = el && el.closest('[data-e]');
    if (!el) { msg('되돌릴 글을 먼저 한 번 눌러서 선택한 뒤 이 버튼을 눌러주세요.'); return; }
    var k = el.getAttribute('data-e'); el.innerHTML = ORIG[k]; applyPhone();
    A.dirtyText[k] = 'reset'; el.classList.add('changed'); msg('처음 디자인의 글로 되돌렸어요. "저장하기"를 눌러야 반영돼요.');
  }

  /* 사진 고르기 → 줄이기 → dataURL */
  function pickImage(cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) shrink(f).then(cb).catch(function () { alertBox('사진을 불러오지 못했어요. 다른 사진으로 시도해 주세요.'); }); };
    inp.click();
  }
  function shrink(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1400, w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * r); c.height = Math.round(h * r);
        var x = c.getContext('2d');
        var out, q = 0.85;
        var tryWebp = c.toDataURL('image/webp', 0.1).indexOf('data:image/webp') === 0;
        if (!tryWebp) { x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(img, 0, 0, c.width, c.height);
        do { out = c.toDataURL(tryWebp ? 'image/webp' : 'image/jpeg', q); q -= 0.1; } while (out.length > 900000 && q > 0.3);
        if (out.length > 900000) { // 그래도 크면 크기를 더 줄임
          var c2 = document.createElement('canvas'); c2.width = Math.round(c.width * 0.7); c2.height = Math.round(c.height * 0.7);
          var x2 = c2.getContext('2d'); if (!tryWebp) { x2.fillStyle = '#FFFFFF'; x2.fillRect(0, 0, c2.width, c2.height); }
          x2.drawImage(c, 0, 0, c2.width, c2.height); out = c2.toDataURL(tryWebp ? 'image/webp' : 'image/jpeg', 0.7);
        }
        URL.revokeObjectURL(url); ok(out);
      };
      img.onerror = no; img.src = url;
    });
  }
  function uploadImage(data) {
    var ref = db.collection('images').doc();
    return ref.set({ data: data, at: firebase.firestore.FieldValue.serverTimestamp() }).then(function () { S.imgCache[ref.id] = data; return ref.id; });
  }
  function deleteImage(id) { if (id) db.collection('images').doc(id).delete().catch(function () {}); }

  /* 전화번호 */
  function phoneBox() {
    var m = modal('<h2>대표 전화번호</h2><p style="font-size:14px;color:#4A5D80;margin:0">여기서 바꾸면 상단·하단·모든 전화/문자 버튼과 문자 수신번호가 함께 바뀌어요.</p>' +
      '<label for="adm-ph">전화번호</label><input id="adm-ph" type="text" inputmode="tel" value="' + esc(S.phone) + '" placeholder="예: 1566-0000">' +
      '<div class="adm-row"><button class="adm-btn" type="button" data-x>취소</button><button class="adm-btn primary" type="button" data-ok>적용</button></div>');
    $('[data-x]', m).onclick = function () { m.remove(); };
    $('[data-ok]', m).onclick = function () {
      var v = $('#adm-ph').value.trim(); if (!/[0-9]{3,}/.test(v)) { $('#adm-ph').focus(); return; }
      S.phone = v; A.dirtyPhone = true; applyPhone(); m.remove(); msg('전화번호를 ' + v + '(으)로 바꿨어요. "저장하기"를 눌러야 반영돼요.');
    };
  }

  /* 메뉴 이름 */
  function navBox() {
    var btns = $$('nav [data-go]');
    var m = modal('<h2>메뉴 이름 바꾸기</h2><p style="font-size:14px;color:#4A5D80;margin:0">상단 메뉴(홈·인사말…)의 이름을 바꿀 수 있어요. 비워두면 원래 이름으로 돌아가요.</p>' +
      btns.map(function (b, i) {
        var k = b.getAttribute('data-go');
        return '<label for="nv-' + i + '">' + esc(b.getAttribute('data-orig') || b.textContent) + '</label><input id="nv-' + i + '" data-k="' + k + '" type="text" value="' + esc(S.content['nav:' + k] || '') + '" placeholder="' + esc(b.getAttribute('data-orig') || b.textContent) + '">';
      }).join('') +
      '<div class="adm-row"><button class="adm-btn" type="button" data-x>취소</button><button class="adm-btn primary" type="button" data-ok>적용</button></div>');
    $('[data-x]', m).onclick = function () { m.remove(); };
    $('[data-ok]', m).onclick = function () {
      $$('input[data-k]', m).forEach(function (inp) {
        var k = 'nav:' + inp.getAttribute('data-k'), v = inp.value.trim();
        if (v) S.content[k] = v; else delete S.content[k];
      });
      A.dirtyNav = true; applyNav(); m.remove(); msg('메뉴 이름을 바꿨어요. "저장하기"를 눌러야 반영돼요.');
    };
  }

  /* 후기 관리 */
  var TAGS = ['일반폐차', '조기폐차', '압류폐차', '상속폐차', '법인폐차'];
  function reviewsBox() {
    var m = modal('<h2>후기 관리 <span style="font-size:14px;color:#4A5D80">(최대 8개 · 위에서부터 홈 화면에 3개 표시)</span></h2><div id="adm-rvl"></div>' +
      '<div class="adm-row"><button class="adm-btn primary" type="button" data-add>+ 후기 추가</button><button class="adm-btn" type="button" data-x>닫기</button></div>');
    var draw = function () {
      $('#adm-rvl', m).innerHTML = S.reviews.map(function (r, i) {
        var src = photoSrc(r);
        return '<div class="adm-rv">' + (src ? '<img src="' + esc(src) + '" alt="">' : '<div class="ph"></div>') +
          '<div class="t"><b>' + esc(r.car) + ' · ' + esc(r.tag) + '</b>' + esc(r.title) + '</div><div class="ops">' +
          '<button type="button" data-up="' + i + '" aria-label="위로">▲</button><button type="button" data-dn="' + i + '" aria-label="아래로">▼</button>' +
          '<button type="button" data-ed="' + i + '">수정</button><button type="button" data-del="' + i + '">삭제</button></div></div>';
      }).join('') || '<p>후기가 없습니다.</p>';
      $('[data-add]', m).disabled = S.reviews.length >= 8;
      $('[data-add]', m).textContent = S.reviews.length >= 8 ? '최대 8개까지 등록돼요' : '+ 후기 추가';
    };
    draw();
    m.addEventListener('click', function (e) {
      var t = e.target, i;
      if (t.closest('[data-x]')) { m.remove(); return; }
      if (t.closest('[data-add]')) { editReview(-1, draw); return; }
      if ((i = t.getAttribute('data-up')) != null && +i > 0) { swap(+i, +i - 1); draw(); }
      if ((i = t.getAttribute('data-dn')) != null && +i < S.reviews.length - 1) { swap(+i, +i + 1); draw(); }
      if ((i = t.getAttribute('data-ed')) != null) editReview(+i, draw);
      if ((i = t.getAttribute('data-del')) != null && confirm('이 후기를 삭제할까요?')) { S.reviews.splice(+i, 1); A.dirtyReviews = true; S.open = {}; renderReviews(); draw(); msg('후기를 삭제했어요. "저장하기"를 눌러야 반영돼요.'); }
    });
    function swap(a, b) { var x = S.reviews[a]; S.reviews[a] = S.reviews[b]; S.reviews[b] = x; A.dirtyReviews = true; S.open = {}; renderReviews(); }
  }
  function editReview(i, after) {
    var r = i >= 0 ? S.reviews[i] : { car: '', tag: '일반폐차', loc: '부산 ', who: '', title: '', text: '', photo: '', example: false };
    var src = photoSrc(r), newPhoto = null, removePhoto = false;
    var m = modal('<h2>' + (i >= 0 ? '후기 수정' : '후기 추가') + '</h2>' +
      '<label>차량 사진</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><img id="rv-pv" alt="" style="width:140px;height:100px;object-fit:cover;border-radius:10px;background:#EEF5FF;' + (src ? '' : 'display:none') + '" src="' + esc(src) + '">' +
      '<button type="button" class="adm-btn" data-pic>사진 선택</button><button type="button" class="adm-btn danger" data-nopic>사진 빼기</button></div>' +
      '<p style="font-size:12.5px;color:#8A5A00;margin:6px 0 0">※ 번호판이 보이는 사진은 미리 가려서 올려주세요.</p>' +
      '<label for="rv-car">차종</label><input id="rv-car" type="text" value="' + esc(r.car) + '" placeholder="예: 현대 아반떼">' +
      '<label for="rv-tag">폐차 종류</label><select id="rv-tag">' + TAGS.map(function (t) { return '<option' + (t === r.tag ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
      '<label for="rv-loc">지역</label><input id="rv-loc" type="text" value="' + esc(r.loc) + '" placeholder="예: 부산 사하구 하단동">' +
      '<label for="rv-who">작성자</label><input id="rv-who" type="text" value="' + esc(r.who) + '" placeholder="예: 김**님">' +
      '<label for="rv-title">제목</label><input id="rv-title" type="text" value="' + esc(r.title) + '">' +
      '<label for="rv-text">후기 내용</label><textarea id="rv-text">' + esc(r.text) + '</textarea>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:15px;color:#0B2A5B"><input id="rv-ex" type="checkbox"' + (r.example ? ' checked' : '') + ' style="width:20px;height:20px"> \'작성 예시\' 표시 붙이기</label>' +
      '<div class="adm-err" id="rv-err"></div><div class="adm-row"><button class="adm-btn" type="button" data-x>취소</button><button class="adm-btn primary" type="button" data-ok>적용</button></div>');
    $('[data-x]', m).onclick = function () { m.remove(); };
    $('[data-pic]', m).onclick = function () { pickImage(function (d) { newPhoto = d; removePhoto = false; var pv = $('#rv-pv', m); pv.src = d; pv.style.display = ''; }); };
    $('[data-nopic]', m).onclick = function () { newPhoto = null; removePhoto = true; $('#rv-pv', m).style.display = 'none'; };
    $('[data-ok]', m).onclick = function () {
      var v = function (id) { return $('#' + id, m).value.trim(); };
      if (!v('rv-car') || !v('rv-title') || !v('rv-text')) { $('#rv-err', m).textContent = '차종, 제목, 후기 내용은 꼭 적어주세요.'; return; }
      var nr = Object.assign({}, r, { car: v('rv-car'), tag: $('#rv-tag', m).value, loc: v('rv-loc'), who: v('rv-who'), title: v('rv-title'), text: v('rv-text'), example: $('#rv-ex', m).checked });
      if (newPhoto) nr._newPhoto = newPhoto;
      if (removePhoto) { nr.photo = ''; delete nr._newPhoto; }
      if (i >= 0) S.reviews[i] = nr; else S.reviews.unshift(nr);
      S.reviews = S.reviews.slice(0, 8);
      A.dirtyReviews = true; S.open = {}; renderReviews(); m.remove(); after(); msg('후기를 고쳤어요. "저장하기"를 눌러야 반영돼요.');
    };
  }

  /* 저장 */
  function saveAll() {
    if (!isDirty()) { msg('바뀐 내용이 없어요.'); return; }
    var btn = $('#adm-bar [data-a="save"]'); btn.disabled = true; msg('저장 중… 잠시만 기다려 주세요.');
    var oldImgIds = [];
    var jobs = Object.keys(A.dirtyImg).map(function (k) {
      return uploadImage(A.dirtyImg[k]).then(function (id) { if (S.images[k]) oldImgIds.push(S.images[k]); S.images[k] = id; });
    });
    S.reviews.forEach(function (r) {
      if (r._newPhoto) jobs.push(uploadImage(r._newPhoto).then(function (id) { if (r.photo && r.photo.indexOf('fs:') === 0) oldImgIds.push(r.photo.slice(3)); r.photo = 'fs:' + id; delete r._newPhoto; }));
    });
    Object.keys(A.dirtyText).forEach(function (k) {
      var el = $('[data-e="' + k + '"]');
      if (A.dirtyText[k] === 'reset' || !el) { delete S.content[k]; return; }
      var c = el.cloneNode(true); c.removeAttribute('contenteditable'); $$('[contenteditable]', c).forEach(function (n) { n.removeAttribute('contenteditable'); });
      S.content[k] = sanitize(c.innerHTML);
    });
    Promise.all(jobs).then(function () {
      var reviews = S.reviews.map(function (r) { return { car: r.car, tag: r.tag, loc: r.loc, who: r.who, title: r.title, text: r.text, photo: r.photo || '', example: !!r.example }; });
      return db.collection('site').doc('main').set({ phone: S.phone, content: S.content, images: S.images, reviews: reviews, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }).then(function () {
      oldImgIds.forEach(deleteImage);
      A.dirtyText = {}; A.dirtyImg = {}; A.dirtyPhone = false; A.dirtyReviews = false; A.dirtyNav = false;
      $$('.changed').forEach(function (el) { el.classList.remove('changed'); });
      msg('저장했어요! 손님이 보는 홈페이지에 바로 반영됐어요. (' + new Date().toLocaleTimeString('ko-KR') + ')');
    }).catch(function (e) {
      msg('저장 실패: ' + (e && e.code === 'permission-denied' ? '관리자 권한이 없는 계정이에요. 보안 규칙의 관리자 이메일을 확인해 주세요.' : (e.message || e)));
    }).then(function () { btn.disabled = false; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
