// Browser-safe configuration only. The publishable key is intended for frontend use.
// Never place a Supabase secret/service-role key in this file.
const SUPABASE_URL = 'https://rafwarhtybmljuflcaex.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8sHgcVY8jFdrRfRreNJJHw_yDo7rR_2';

const HOLIDAYS = {
  '2026-11-08': 'Diwali Laxmi Pujan',
  '2026-11-10': 'Diwali-Balipratipada',
  '2026-11-24': 'Prakash Gurpurab Sri Guru Nanak Dev',
  '2026-12-25': 'Christmas'
};

const $ = (id) => document.getElementById(id);
let supabaseClient, currentUser, currentProfile, currentRole = 'user';
let currentRows = [], autoSaveTimer = null, sessionStarting = false, recoveryMode = false;
let calendarEditingIndex = -1, loadedMonth = null, adminDirectory = [];

const monthKey = () => $('month')?.value || new Date().toISOString().slice(0, 7);
const dateKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const isAdminPage = document.body.dataset.page === 'admin';

function dayType(date) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if (weekday === 0 || weekday === 6) return 'Weekend';
  if (HOLIDAYS[date]) return 'Holiday';
  return 'Working';
}
function rowClass(type) {
  if (type === 'Weekend') return 'weekend';
  if (type === 'Holiday') return 'holiday';
  if (['Personal leave', 'Emergency leave', 'Paternity leave'].includes(type)) return 'leave';
  return 'working';
}
function displayType(row) {
  if (row.day_type === 'Weekend') return 'Weekend';
  if (row.day_type === 'Holiday') return `Holiday - ${HOLIDAYS[row.work_date]}`;
  return ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status) ? row.day_status : 'Working';
}
function say(id, message) {
  const el = $(id);
  if (el) el.textContent = message;
}
function setSignedIn(on) {
  $('auth-panel')?.classList.toggle('hidden', on);
  $('app-panel')?.classList.toggle('hidden', !on);
  $('admin-page-panel')?.classList.toggle('hidden', !on || currentRole !== 'admin');
  const sessionArea = $('session-area');
  if (!sessionArea) return;
  sessionArea.replaceChildren();
  if (!on) return;
  menuAbort.abort();
  menuAbort = new AbortController();
  const wrapper = document.createElement('div');
  wrapper.className = 'user-menu';
  const toggle = document.createElement('button');
  toggle.className = 'user-menu-trigger';
  toggle.type = 'button';
  toggle.title = 'Account menu';
  toggle.setAttribute('aria-label', 'Account menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-5 3-8 8-8s8 3 8 8"/></svg>';
  const panel = document.createElement('div');
  panel.className = 'user-menu-panel hidden';
  if (currentRole === 'admin') {
    const link = document.createElement('a');
    link.href = 'admin.html';
    link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/></svg><span>Admin Settings</span>';
    panel.append(link);
  }
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3H4v18h5M13 7l5 5-5 5M8 12h10"/></svg><span>Sign out</span>';
  logout.onclick = signOut;
  panel.append(logout);
  toggle.onclick = () => {
    const isOpen = panel.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', String(isOpen));
  };
  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) {
      panel.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    }
  }, { signal: menuAbort.signal });
  wrapper.append(toggle, panel);
  sessionArea.append(wrapper);
}
let menuAbort = new AbortController();
async function init() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || SUPABASE_URL.includes('YOUR_') || SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) {
    $('setup-warning')?.classList.remove('hidden');
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  $('login-form')?.addEventListener('submit', login);
  $('forgot-password')?.addEventListener('click', requestPasswordReset);
  $('reset-password-form')?.addEventListener('submit', updatePassword);
  $('month')?.addEventListener('change', async () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      // Preserve edits in the previously displayed month before switching.
      await saveRows({ reload: false });
    }
    await loadMonth();
  });
  $('view-mode')?.addEventListener('change', renderView);
  $('day-editor-apply')?.addEventListener('click', applyDayEditor);
  $('save-all')?.addEventListener('click', saveRows);
  $('export-own')?.addEventListener('click', exportOwn);
  $('invite-form')?.addEventListener('submit', inviteUser);
  $('export-form')?.addEventListener('submit', adminExport);
  $('export-all-users')?.addEventListener('change', updateExportPicker);
  $('export-picker-toggle')?.addEventListener('click', () => {
    const panel = $('export-picker-panel');
    const open = panel.classList.toggle('hidden') === false;
    $('export-picker-toggle').setAttribute('aria-expanded', String(open));
  });
  $('admin-view-load')?.addEventListener('click', viewUserTimesheet);
  $('admin-view-user')?.addEventListener('change', () => say('admin-view-message', ''));
  $('refresh-users')?.addEventListener('click', loadUsers);

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      $('auth-panel')?.classList.add('hidden');
      $('app-panel')?.classList.add('hidden');
      $('admin-page-panel')?.classList.add('hidden');
      $('password-reset-panel')?.classList.remove('hidden');
      say('reset-message', 'Enter a new password for your account.');
      return;
    }
    if (session && !recoveryMode) startSession(session.user);
    else if (!session) {
      currentUser = null;
      currentProfile = null;
      currentRole = 'user';
      setSignedIn(false);
    }
  });
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && !recoveryMode) await startSession(session.user);
}
async function login(event) {
  event.preventDefault();
  say('auth-message', 'Signing in…');
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value
  });
  say('auth-message', error ? error.message : 'Signed in. Loading your timesheet…');
}

async function requestPasswordReset() {
  const email = $('email')?.value.trim();
  if (!email) {
    say('auth-message', 'Enter your registered email address first.');
    $('email')?.focus();
    return;
  }
  say('auth-message', 'Sending password reset email…');
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  say('auth-message', error
    ? `Could not send reset email: ${error.message}`
    : 'If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.');
}
async function updatePassword(event) {
  event.preventDefault();
  const password = $('new-password')?.value || '';
  const confirm = $('confirm-password')?.value || '';
  if (password.length < 10) {
    say('reset-message', 'Use a password with at least 10 characters.');
    return;
  }
  if (password !== confirm) {
    say('reset-message', 'The passwords do not match.');
    return;
  }
  say('reset-message', 'Updating password…');
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    say('reset-message', `Password update failed: ${error.message}`);
    return;
  }
  recoveryMode = false;
  await supabaseClient.auth.signOut();
  $('password-reset-panel')?.classList.add('hidden');
  $('auth-panel')?.classList.remove('hidden');
  $('reset-password-form')?.reset();
  say('auth-message', 'Your password has been updated. Please sign in with your new password.');
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}
async function startSession(user) {
  if (sessionStarting) return;
  sessionStarting = true;
  try {
    currentUser = user;
    const { data: profile, error } = await supabaseClient.from('profiles')
      .select('id,full_name,is_active').eq('id', user.id).single();
    if (error || !profile || !profile.is_active) {
      say('auth-message', 'Your account is not active. Contact an administrator.');
      await supabaseClient.auth.signOut();
      return;
    }
    currentProfile = profile;
    const { data: roleData, error: roleError } = await supabaseClient.rpc('current_user_role');
    if (roleError) {
      say('auth-message', 'Could not verify your account permissions.');
      await supabaseClient.auth.signOut();
      return;
    }
    currentRole = roleData || 'user';
    setSignedIn(true);

    if (isAdminPage && currentRole !== 'admin') {
      $('admin-denied')?.classList.remove('hidden');
      return;
    }

    const fullName = currentProfile.full_name || user.email?.split('@')[0] || 'User';
    $('welcome') && ($('welcome').textContent = `Hello, ${fullName}`);
    $('resource-name') && ($('resource-name').textContent = fullName);
    $('role-label') && ($('role-label').textContent = currentRole === 'admin' ? 'Administrator' : 'Personal timesheet');

    if (isAdminPage) {
      $('admin-page-title').textContent = 'Admin Settings';
      $('admin-page-user').textContent = `Signed in as ${fullName}`;
      $('admin-month').value = new Date().toISOString().slice(0, 7);
      $('admin-view-month').value = $('admin-month').value;
      $('app-panel')?.classList.add('hidden');
      $('admin-page-panel')?.classList.remove('hidden');
      await loadUsers();
    } else {
      $('month').value = $('month').value || new Date().toISOString().slice(0, 7);
      await loadMonth();
    }
  } finally {
    sessionStarting = false;
  }
}
function buildDates(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const totalDays = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: totalDays }, (_, index) => {
    const date = dateKey(year, monthNumber - 1, index + 1);
    const dayTypeValue = dayType(date);
    return {
      work_date: date,
      day_name: new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }),
      day_type: dayTypeValue,
      day_status: 'Working',
      task: '',
      hours: 0
    };
  });
}
async function loadMonth() {
  if (!currentUser || !$('month')) return;
  const dates = buildDates(monthKey());
  const { data, error } = await supabaseClient.from('timesheets')
    .select('id,user_id,work_date,task,hours,day_status')
    .gte('work_date', dates[0].work_date)
    .lte('work_date', dates[dates.length - 1].work_date)
    .order('work_date');
  if (error) {
    say('save-message', `Could not load timesheet: ${error.message}`);
    return;
  }
  const saved = new Map((data || []).map(row => [row.work_date, row]));
  currentRows = dates.map(dateRow => {
    const existing = saved.get(dateRow.work_date);
    return {
      ...dateRow,
      ...(existing || {}),
      day_status: dateRow.day_type === 'Working' && ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(existing?.day_status) ? existing.day_status : 'Working',
      task: existing ? (existing.task || '') : dateRow.task,
      hours: existing?.hours ?? 0
    };
  });
  loadedMonth = monthKey();
  renderRows();
}
function renderRows() {
  const body = $('entries');
  if (!body) return;
  body.replaceChildren();
  currentRows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.className = rowClass(row.day_type === 'Working' ? row.day_status : row.day_type);

    const dateCell = document.createElement('td');
    dateCell.textContent = new Date(`${row.work_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const dayCell = document.createElement('td');
    dayCell.textContent = row.day_name;
    const typeCell = document.createElement('td');

    if (row.day_type === 'Working') {
      const status = document.createElement('select');
      status.setAttribute('aria-label', `Day status for ${row.work_date}`);
      for (const value of ['Working', 'Personal leave', 'Emergency leave', 'Paternity leave']) status.add(new Option(value, value));
      status.value = row.day_status;
      status.addEventListener('change', () => {
        currentRows[index].day_status = status.value;
        tr.className = rowClass(status.value);
        updateKPIs();
        scheduleAutoSave();
      });
      typeCell.append(status);
    } else {
      typeCell.textContent = displayType(row);
    }

    const taskCell = document.createElement('td');
    const taskInput = document.createElement('input');
    taskInput.maxLength = 1000;
    taskInput.value = row.task || '';
    taskInput.placeholder = 'Enter task description';
    taskInput.addEventListener('input', () => {
      currentRows[index].task = taskInput.value;
      scheduleAutoSave();
    });
    taskCell.append(taskInput);

    const hoursCell = document.createElement('td');
    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.min = '0';
    hoursInput.max = '24';
    hoursInput.step = '0.25';
    hoursInput.value = String(row.hours ?? 0);
    hoursInput.placeholder = '0';
    hoursInput.addEventListener('input', () => {
      currentRows[index].hours = hoursInput.value;
      updateKPIs();
      scheduleAutoSave();
    });
    hoursCell.append(hoursInput);
    tr.append(dateCell, dayCell, typeCell, taskCell, hoursCell);
    body.append(tr);
  });
  updateKPIs();
  renderView();
}
function updateKPIs() {
  const total = currentRows.reduce((sum, row) => sum + (Number(row.hours) || 0), 0);
  const [year, monthNumber] = monthKey().split('-').map(Number);
  const totalDays = new Date(year, monthNumber, 0).getDate();
  // Scheduled working days exclude only Saturdays, Sundays and public holidays.
  // Leave is reported separately and does not reduce the monthly hours target.
  const workingDays = currentRows.filter(row => row.day_type === 'Working').length;
  const monthlyTarget = workingDays * 8;
  const holidays = currentRows.filter(row => row.day_type === 'Holiday');
  const leaveDays = currentRows.filter(row => row.day_type === 'Working' && ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status)).length;
  $('total-hours').textContent = `${formatHours(total)} / ${monthlyTarget}`;
  $('hours-target-note').textContent = `Target: ${workingDays} working days × 8 hours`;
  $('holiday-count').textContent = String(holidays.length);
  $('holiday-dates').textContent = holidays.map(row => {
    const date = new Date(`${row.work_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    return `${date} - ${HOLIDAYS[row.work_date]}`;
  }).join(', ') || 'No holidays';
  $('working-days').textContent = `${workingDays} / ${totalDays}`;
  $('leave-count').textContent = String(leaveDays);
  const leaveCategories = ['Personal leave', 'Emergency leave', 'Paternity leave'];
  $('leave-types').textContent = leaveCategories.map(type => {
    const dates = currentRows.filter(row => row.day_type === 'Working' && row.day_status === type).map(row => Number(row.work_date.slice(-2)));
    return dates.length ? `${type} – ${dates.join(', ')}` : '';
  }).filter(Boolean).join('; ') || 'No leaves';
  if ($('resource-name')) $('resource-name').textContent = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User';
}
function formatHours(value) {
  return Number(value.toFixed(2)).toString();
}
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  say('save-message', 'Unsaved changes — saving automatically…');
  autoSaveTimer = setTimeout(saveRows, 1200);
}
async function saveRows({ reload = true } = {}) {
  if (!currentUser) return;
  clearTimeout(autoSaveTimer);
  const payload = currentRows.map(row => ({
    user_id: currentUser.id,
    work_date: row.work_date,
    task: (row.task || '').trim(),
    hours: row.hours === '' || row.hours == null ? 0 : Number(row.hours),
    day_status: row.day_type === 'Working' ? row.day_status : 'Working'
  }));
  if (payload.some(row => (!Number.isFinite(row.hours) || row.hours < 0 || row.hours > 24))) {
    say('save-message', 'Hours must be between 0 and 24.');
    return;
  }
  const { error } = await supabaseClient.from('timesheets').upsert(payload, { onConflict: 'user_id,work_date' });
  say('save-message', error ? `Save failed: ${error.message}` : 'All entries saved successfully.');
  if (!error && reload && loadedMonth === monthKey()) await loadMonth();
  return !error;
}
function addRowsToWorksheet(workbook, rows, sheetName = 'Timesheet', fallbackResourceName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User') {
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 16 },
    { header: 'Resource', key: 'resource', width: 20 },
    { header: 'Task', key: 'task', width: 58 },
    { header: 'Hour', key: 'hours', width: 12 }
  ];
  worksheet.getRow(1).height = 24;
  const cellBorder = {
    top: { style: 'thin', color: { argb: 'FF9AA9BA' } },
    bottom: { style: 'thin', color: { argb: 'FF9AA9BA' } },
    left: { style: 'thin', color: { argb: 'FF9AA9BA' } },
    right: { style: 'thin', color: { argb: 'FF9AA9BA' } }
  };
  const columnAlignment = ['left', 'center', 'left', 'center'];
  worksheet.getRow(1).eachCell((cell, columnNumber) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102B50' } };
    cell.alignment = { vertical: 'middle', horizontal: columnAlignment[columnNumber - 1], wrapText: true };
    cell.border = cellBorder;
  });

  let totalHours = 0;
  rows.forEach(row => {
    const type = row.day_type || dayType(row.work_date);
    const holidayName = HOLIDAYS[row.work_date];
    const leaveType = ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status) ? row.day_status : '';
    const taskText = type === 'Holiday' ? (row.task ? `${row.task} (Holiday - ${holidayName})` : `Holiday - ${holidayName}`) : type === 'Weekend' ? (row.task || 'Weekend') : leaveType ? (row.task ? `${row.task} (${leaveType})` : leaveType) : (row.task || '');
    const excelRow = worksheet.addRow({
      date: new Date(`${row.work_date}T12:00:00`),
      resource: row.resource || fallbackResourceName,
      task: taskText,
      hours: row.hours === '' || row.hours == null ? 0 : Number(row.hours)
    });
    excelRow.getCell(1).numFmt = 'dd-mmm-yyyy';
    excelRow.getCell(4).numFmt = '0.00';
    totalHours += Number(row.hours) || 0;
    const fill = type === 'Weekend' ? 'FFEAF0F7' : type === 'Holiday' ? 'FFFFF0C2' : ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status) ? 'FFFBE5E7' : 'FFFFFFFF';
    excelRow.eachCell((cell, columnNumber) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.alignment = { vertical: 'top', horizontal: columnAlignment[columnNumber - 1], wrapText: true };
      cell.border = cellBorder;
    });
  });

  const totalRow = worksheet.addRow({ date: '', resource: '', task: 'TOTAL HOURS', hours: totalHours });
  const totalRowNumber = totalRow.number;
  worksheet.mergeCells(`A${totalRowNumber}:C${totalRowNumber}`);
  worksheet.getCell(`A${totalRowNumber}`).value = 'TOTAL HOURS';
  worksheet.getCell(`D${totalRowNumber}`).value = totalHours;
  worksheet.getCell(`D${totalRowNumber}`).numFmt = '0.00';
  for (let column = 1; column <= 4; column++) {
    const cell = totalRow.getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102B50' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: column === 4 ? 'center' : 'left' };
    cell.border = cellBorder;
  }
  totalRow.height = 22;
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: `D${Math.max(1, rows.length + 1)}` };
  return worksheet;
}

function downloadWorkbook(workbook, filename) {
  return workbook.xlsx.writeBuffer().then(buffer => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}

function exportRowsToExcel(rows, filename, sheetName = 'Timesheet', fallbackResourceName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User') {
  const workbook = new ExcelJS.Workbook();
  addRowsToWorksheet(workbook, rows, sheetName, fallbackResourceName);
  return downloadWorkbook(workbook, filename);
}

function exportAllUsersToExcel(rows, users, filename) {
  const workbook = new ExcelJS.Workbook();
  const grouped = new Map();
  (users || []).forEach(user => grouped.set(user.id, { name: user.full_name || 'User', rows: [] }));
  rows.forEach(row => {
    const key = row.user_id || row.resource || 'unknown';
    if (!grouped.has(key)) grouped.set(key, { name: row.resource || 'User', rows: [] });
    grouped.get(key).rows.push(row);
  });

  const usedNames = new Set();
  for (const [key, group] of grouped.entries()) {
    let baseName = String(group.name || 'User').replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || 'User';
    let sheetName = baseName;
    let suffix = 2;
    while (usedNames.has(sheetName.toLowerCase())) {
      const ending = ` (${suffix++})`;
      sheetName = `${baseName.slice(0, 31 - ending.length)}${ending}`;
    }
    usedNames.add(sheetName.toLowerCase());
    const userRows = group.rows.map(row => ({ ...row, day_type: row.day_type || dayType(row.work_date) }));
    addRowsToWorksheet(workbook, userRows, sheetName, group.name);
  }

  if (!workbook.worksheets.length) addRowsToWorksheet(workbook, [], 'Timesheet');
  return downloadWorkbook(workbook, filename);
}

async function exportOwn() {
  const resourceName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User';
  const safeName = resourceName.replace(/[^a-z0-9_-]+/gi, '_');
  const filename = `Timesheet_${safeName}_${monthKey()}.xlsx`;
  await exportRowsToExcel(currentRows, filename, 'Timesheet', resourceName);
}
async function inviteUser(event) {
  event.preventDefault();
  say('invite-message', 'Sending invitation…');
  const { data, error } = await supabaseClient.functions.invoke('admin-invite', {
    body: { email: $('invite-email').value.trim(), full_name: $('invite-name').value.trim() }
  });
  say('invite-message', error ? `Invitation failed: ${error.message}` : (data?.message || 'Invitation sent.'));
  if (!error) {
    $('invite-form').reset();
    await loadUsers();
  }
}
async function adminExport(event) {
  event.preventDefault();
  const allUsers = $('export-all-users')?.checked === true;
  const selectedIds = [...document.querySelectorAll('#export-user-list input[name="export-user"]:checked')].map(input => input.value);
  if (!allUsers && !selectedIds.length) {
    say('export-message', 'Select All users or at least one user.');
    return;
  }
  say('export-message', 'Preparing secure export…');
  const { data, error } = await supabaseClient.functions.invoke('admin-export', {
    body: { month: $('admin-month').value, user_ids: allUsers ? 'all' : selectedIds }
  });
  if (error) {
    say('export-message', `Export failed: ${error.message}`);
    return;
  }
  const rows = (data?.rows || []).map(row => ({ ...row, day_type: dayType(row.work_date), day_status: row.day_status || 'Working' }));
  const users = data?.users || [];
  if (!users.length) {
    say('export-message', 'No users found for this selection.');
    return;
  }
  const selectionLabel = allUsers ? 'AllUsers' : (users.length === 1 ? 'SelectedUser' : 'SelectedUsers');
  await exportAllUsersToExcel(rows, users, `Timesheets_${$('admin-month').value}_${selectionLabel}.xlsx`);
  say('export-message', `Downloaded ${users.length} user worksheet${users.length === 1 ? '' : 's'}.`);
}
async function loadUsers() {
  if (currentRole !== 'admin') return;
  const { data, error } = await supabaseClient.from('admin_user_directory')
    .select('id,full_name,email,is_active,role').order('full_name');
  if (error) {
    say('invite-message', `Could not load users: ${error.message}`);
    return;
  }
  adminDirectory = data || [];
  const viewPicker = $('admin-view-user');
  if (viewPicker) {
    const oldValue = viewPicker.value;
    viewPicker.replaceChildren(new Option('Select user', ''));
    for (const user of adminDirectory) viewPicker.add(new Option(user.full_name || user.email || 'User', user.id));
    viewPicker.value = oldValue;
  }
  const picker = $('export-user-list');
  if (picker) picker.replaceChildren();
  const body = $('users-list');
  if (!body) return;
  body.replaceChildren();
  for (const user of data || []) {
    if (picker) {
      const label = document.createElement('label');
      label.className = 'export-check-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'export-user';
      checkbox.value = user.id;
      checkbox.checked = false;
      checkbox.disabled = false;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) $('export-all-users').checked = false;
        updateExportPicker();
      });
      const name = document.createElement('span');
      name.textContent = user.full_name || user.email || 'User';
      label.append(checkbox, name);
      picker.append(label);
    }
    const tr = document.createElement('tr');
    for (const value of [user.full_name, user.email, user.role, user.is_active ? 'Active' : 'Disabled']) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    const actions = document.createElement('td');
    const statusButton = document.createElement('button');
    statusButton.className = 'secondary';
    statusButton.textContent = user.is_active ? 'Deactivate' : 'Reactivate';
    statusButton.disabled = user.id === currentUser.id && !user.is_active;
    statusButton.onclick = () => toggleUser(user.id, !user.is_active);
    actions.append(statusButton);
    const roleButton = document.createElement('button');
    roleButton.className = 'secondary';
    roleButton.style.marginLeft = '6px';
    roleButton.textContent = user.role === 'admin' ? 'Make user' : 'Make admin';
    roleButton.onclick = () => changeRole(user.id, user.role === 'admin' ? 'user' : 'admin');
    actions.append(roleButton);
    tr.append(actions);
    body.append(tr);
  }
  updateExportPicker();
}
async function toggleUser(userId, isActive) {
  if (!confirm(`${isActive ? 'Reactivate' : 'Deactivate'} this account?`)) return;
  const { data, error } = await supabaseClient.functions.invoke('admin-set-user-status', { body: { user_id: userId, is_active: isActive } });
  if (error) { say('invite-message', error.message); return; }
  say('invite-message', data?.message || 'Account status updated.');
  await loadUsers();
}
async function changeRole(userId, role) {
  if (!confirm(`Change this account role to ${role}?`)) return;
  const { data, error } = await supabaseClient.functions.invoke('admin-set-role', { body: { user_id: userId, role } });
  say('invite-message', error ? error.message : (data?.message || 'Role updated.'));
  if (!error) await loadUsers();
}


function renderView() {
  if (!$('view-mode')) return;
  const calendar = $('view-mode').value === 'calendar';
  $('table-view')?.classList.toggle('hidden', calendar);
  $('calendar-view')?.classList.toggle('hidden', !calendar);
  if (calendar) renderCalendar();
}
function renderCalendar() {
  const grid = $('calendar-grid');
  if (!grid || !currentRows.length) return;
  grid.replaceChildren();
  const leading = new Date(`${currentRows[0].work_date}T12:00:00`).getDay();
  for (let n = 0; n < leading; n++) {
    const blank = document.createElement('span');
    blank.className = 'calendar-empty';
    grid.append(blank);
  }
  currentRows.forEach((row, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `calendar-day ${rowClass(row.day_type === 'Working' ? row.day_status : row.day_type)}`;
    const date = document.createElement('span');
    date.className = 'calendar-date';
    date.textContent = String(Number(row.work_date.slice(-2)));
    const code = document.createElement('span');
    code.className = 'calendar-code';
    code.textContent = row.day_type === 'Weekend' ? 'WE' : row.day_type === 'Holiday' ? 'H' : row.day_status === 'Personal leave' ? 'PL' : row.day_status === 'Emergency leave' ? 'EL' : row.day_status === 'Paternity leave' ? 'PT' : '';
    const hours = document.createElement('span');
    hours.className = 'calendar-hours';
    hours.textContent = `${Number(row.hours) || 0}h`;
    button.append(date, code, hours);
    button.setAttribute('aria-label', `${row.work_date}: ${displayType(row)}, ${hours.textContent}. Edit day`);
    button.onclick = () => openDayEditor(index);
    grid.append(button);
  });
}
function openDayEditor(index) {
  const row = currentRows[index];
  if (!row) return;
  calendarEditingIndex = index;
  $('day-editor-title').textContent = new Date(`${row.work_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  $('day-editor-kind').textContent = displayType(row);
  $('day-editor-status-wrap').classList.toggle('hidden', row.day_type !== 'Working');
  $('day-editor-status').value = row.day_status;
  $('day-editor-task').value = row.task || '';
  $('day-editor-hours').value = String(row.hours ?? 0);
  $('day-editor').showModal();
}
function applyDayEditor() {
  if (calendarEditingIndex < 0) return;
  const hours = Number($('day-editor-hours').value || 0);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    $('day-editor-hours').setCustomValidity('Hours must be between 0 and 24.');
    $('day-editor-hours').reportValidity();
    $('day-editor-hours').setCustomValidity('');
    return;
  }
  const row = currentRows[calendarEditingIndex];
  row.task = $('day-editor-task').value;
  row.hours = hours;
  if (row.day_type === 'Working') row.day_status = $('day-editor-status').value;
  $('day-editor').close();
  renderRows();
  scheduleAutoSave();
}
function updateExportPicker() {
  if (!$('export-all-users')) return;
  const all = $('export-all-users').checked;
  const checks = [...document.querySelectorAll('#export-user-list input[name="export-user"]')];
  if (all) checks.forEach(input => { input.checked = false; });
  const names = checks.filter(input => input.checked).map(input => adminDirectory.find(user => user.id === input.value)?.full_name || 'User');
  const label = all ? 'All users' : names.length ? `${names.length} user${names.length === 1 ? '' : 's'} selected` : 'Select users';
  $('export-picker-label').textContent = label;
  $('export-picker-summary').textContent = all ? 'All users selected — one worksheet per user.' : names.length ? `${names.join(', ')} — one worksheet per selected user.` : 'Select at least one user.';
}
async function viewUserTimesheet() {
  if (currentRole !== 'admin') return;
  const userId = $('admin-view-user').value;
  const month = $('admin-view-month').value;
  if (!userId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    say('admin-view-message', 'Select a user and month first.');
    return;
  }
  say('admin-view-message', 'Loading selected user timesheet…');
  $('admin-view-results').classList.add('hidden');
  const { data, error } = await supabaseClient.functions.invoke('admin-export', { body: { month, user_ids: [userId] } });
  if (error || !data?.users?.some(user => user.id === userId)) {
    say('admin-view-message', error ? `Unable to load timesheet: ${error.message}` : 'Unable to find the selected user.');
    return;
  }
  const user = data.users.find(user => user.id === userId);
  const rowsByDate = new Map((data.rows || []).filter(row => row.user_id === userId).map(row => [row.work_date, row]));
  const rows = buildDates(month).map(row => ({ ...row, ...(rowsByDate.get(row.work_date) || {}) }));
  $('admin-view-name').textContent = user.full_name;
  $('admin-view-total').textContent = `Total: ${formatHours(rows.reduce((sum, row) => sum + (Number(row.hours) || 0), 0))} hours`;
  const tbody = $('admin-view-entries');
  tbody.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = rowClass(row.day_type === 'Working' ? row.day_status : row.day_type);
    const fields = [new Date(`${row.work_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), row.day_name, displayType(row), row.task || '', String(row.hours ?? 0)];
    for (const field of fields) { const td = document.createElement('td'); td.textContent = field; tr.append(td); }
    tbody.append(tr);
  }
  $('admin-view-results').classList.remove('hidden');
  say('admin-view-message', `Viewing ${user.full_name}'s timesheet (read-only).`);
}

init();
