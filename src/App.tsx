import { FormEvent, useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  AppWindow, CircleAlert, CircleCheck, Cloud, LayoutDashboard,
  LoaderCircle, LogOut, Menu, Plus, RefreshCw, Search, Shield, Trash2, UserRound,
  UsersRound, X,
} from "lucide-react";
import { auth, functions, googleProvider } from "./firebase";
import type { AccessUser, AdminData, AdminRecord, View, WebApp } from "./types";

const call = <TResult,>(name: string, data?: unknown) =>
  httpsCallable<unknown, TResult>(functions, name)(data).then((result) => result.data);

function getMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  return raw.replace(/^Firebase:\s*/i, "").replace(/^functions\/[a-z-]+:\s*/i, "");
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<AdminData>({ users: [], apps: [], admins: [] });
  const [view, setView] = useState<View>("dashboard");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [userEditor, setUserEditor] = useState<AccessUser | null | undefined>(undefined);
  const [adminEditor, setAdminEditor] = useState(false);

  const loadData = useCallback(async (refreshApps = false) => {
    setLoading(true);
    setError("");
    try {
      if (refreshApps) {
        setSyncing(true);
        await call("listFirebaseWebApps", { sync: true });
      }
      const result = await call<AdminData>("getAdminData");
      setData(result);
      setAuthorized(true);
    } catch (err) {
      const message = getMessage(err);
      setError(message);
      if (/not authorized|permission/i.test(message)) {
        setAuthorized(false);
        await signOut(auth);
      }
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => onAuthStateChanged(auth, async (user) => {
    setAuthUser(user);
    setAuthReady(true);
    if (!user) {
      setAuthorized(false);
      return;
    }
    await loadData(true);
  }), [loadData]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function login() {
    setError("");
    try { await signInWithPopup(auth, googleProvider); } catch (err) { setError(getMessage(err)); }
  }

  async function refreshApps() {
    try {
      await loadData(true);
      setToast("Firebase web apps refreshed.");
    } catch { /* handled in loadData */ }
  }

  async function saveUser(value: AccessUser) {
    setLoading(true);
    try {
      await call("saveAccessUser", value);
      await loadData();
      setUserEditor(undefined);
      setToast(value.id ? "User access updated." : "User added.");
    } catch (err) { setError(getMessage(err)); } finally { setLoading(false); }
  }

  async function deleteUser(user: AccessUser) {
    if (!window.confirm(`Delete ${user.email} and revoke all access? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await call("deleteAccessUser", { email: user.email });
      await loadData();
      setUserEditor(undefined);
      setToast("User deleted and access revoked.");
    } catch (err) { setError(getMessage(err)); } finally { setLoading(false); }
  }

  async function saveAdmin(input: { email: string; name: string }) {
    setLoading(true);
    try {
      await call("saveAdmin", input);
      await loadData();
      setAdminEditor(false);
      setToast("Administrator added.");
    } catch (err) { setError(getMessage(err)); } finally { setLoading(false); }
  }

  async function toggleAdmin(admin: AdminRecord) {
    if (admin.uid === authUser?.uid && admin.active) {
      setError("You cannot disable your own administrator account.");
      return;
    }
    setLoading(true);
    try {
      await call("setAdminStatus", { id: admin.id, pending: !!admin.pending, active: !admin.active });
      await loadData();
      setToast(`Administrator ${admin.active ? "disabled" : "enabled"}.`);
    } catch (err) { setError(getMessage(err)); } finally { setLoading(false); }
  }

  if (!authReady) return <LoadingScreen />;
  if (!authUser || !authorized) return <Login onLogin={login} error={error} loading={loading} />;

  const nav: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: UsersRound },
    { id: "apps", label: "Apps", icon: AppWindow },
    { id: "admins", label: "Admins", icon: Shield },
  ];

  return (
    <div className="shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Shield size={19} /></span><span>Access Manager<small>Firebase administration</small></span></div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setMobileNav(false); }}>
              <Icon size={18} />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="profile"><img src={authUser.photoURL || ""} alt="" /><span><strong>{authUser.displayName || "Administrator"}</strong><small>{authUser.email}</small></span></div>
          <button className="signout" onClick={() => signOut(auth)} aria-label="Sign out"><LogOut size={18} /></button>
        </div>
      </aside>
      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main>
        <header className="topbar">
          <button className="icon-button menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div><p>School Softwares</p><span>inter-level-progress-manager</span></div>
          <div className="project-pill"><span /> System online</div>
        </header>
        <section className="content">
          {error && <div className="alert"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError("")}><X size={17} /></button></div>}
          {view === "dashboard" && <Dashboard data={data} setView={setView} />}
          {view === "users" && <Users data={data} edit={setUserEditor} add={() => setUserEditor(null)} />}
          {view === "apps" && <Apps apps={data.apps} users={data.users} refresh={refreshApps} syncing={syncing} />}
          {view === "admins" && <Admins admins={data.admins} add={() => setAdminEditor(true)} toggle={toggleAdmin} />}
        </section>
      </main>
      {userEditor !== undefined && <UserModal initial={userEditor} apps={data.apps} close={() => setUserEditor(undefined)} save={saveUser} remove={deleteUser} busy={loading} />}
      {adminEditor && <AdminModal close={() => setAdminEditor(false)} save={saveAdmin} busy={loading} />}
      {toast && <div className="toast"><CircleCheck size={18} />{toast}</div>}
    </div>
  );
}

function LoadingScreen() {
  return <div className="loading-screen"><span className="brand-mark"><Shield size={24} /></span><LoaderCircle className="spin" size={24} /><p>Securing your workspace…</p></div>;
}

function Login({ onLogin, error, loading }: { onLogin: () => void; error: string; loading: boolean }) {
  return <div className="login-page">
    <div className="login-visual"><div className="login-brand"><span className="brand-mark"><Shield size={22} /></span>Firebase Access Manager</div><div className="visual-copy"><span>ADMIN CONTROL PANEL</span><h1>One secure place for every app and account.</h1><p>Control who can access each Firebase web app without exposing privileged credentials.</p></div><div className="trust-row"><span><CircleCheck size={16} />Admin verified</span><span><CircleCheck size={16} />Server enforced</span><span><CircleCheck size={16} />Always in sync</span></div></div>
    <div className="login-panel"><div className="login-card"><span className="eyebrow">SECURE SIGN IN</span><h2>Welcome back</h2><p>Sign in with an approved administrator account to continue.</p>{error && <div className="login-error"><CircleAlert size={17} />{error}</div>}<button className="google-button" onClick={onLogin} disabled={loading}><GoogleIcon />{loading ? "Verifying account…" : "Continue with Google"}</button><div className="security-note"><Shield size={17} /><span><strong>Restricted administration</strong>Your account is verified against the protected administrator registry after sign-in.</span></div></div><p className="login-footer">Firebase project · inter-level-progress-manager</p></div>
  </div>;
}

function GoogleIcon() { return <span className="google-icon">G</span>; }

function PageHead({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Dashboard({ data, setView }: { data: AdminData; setView: (v: View) => void }) {
  const activeUsers = data.users.filter((u) => u.active).length;
  const cards = [
    { label: "Total users", value: data.users.length, detail: `${activeUsers} currently active`, icon: UsersRound, view: "users" as View },
    { label: "Active access", value: activeUsers, detail: `${data.users.length - activeUsers} disabled`, icon: UserRound, view: "users" as View },
    { label: "Firebase web apps", value: data.apps.filter((a) => a.active).length, detail: "Synced from Firebase", icon: AppWindow, view: "apps" as View },
    { label: "Administrators", value: data.admins.filter((a) => a.active).length, detail: `${data.admins.filter((a) => a.pending).length} pending`, icon: Shield, view: "admins" as View },
  ];
  return <>
    <PageHead eyebrow="OVERVIEW" title="Access at a glance" description="Monitor authorized accounts and application coverage across your Firebase project." />
    <div className="stats-grid">{cards.map(({ label, value, detail, icon: Icon, view }) => <button className="stat-card" key={label} onClick={() => setView(view)}><span className="stat-icon"><Icon size={19} /></span><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></button>)}</div>
    <div className="dashboard-grid">
      <div className="panel"><div className="panel-title"><div><h2>Recent users</h2><p>Latest permission updates</p></div><button className="text-button" onClick={() => setView("users")}>View all</button></div>{data.users.length ? <div className="compact-list">{data.users.slice(0, 5).map((user) => <div key={user.email}><Avatar name={user.displayName || user.email} /><span><strong>{user.displayName || user.email.split("@")[0]}</strong><small>{user.email}</small></span><Status active={user.active} /></div>)}</div> : <Empty icon={UsersRound} title="No users yet" text="Add the first approved account from Users." />}</div>
      <div className="panel sync-panel"><div className="sync-orbit"><Cloud size={28} /></div><span className="eyebrow">APP REGISTRY</span><h2>Connected to Firebase</h2><p>{data.apps.length} web apps are available for permission assignments.</p><button className="secondary-button" onClick={() => setView("apps")}>Review apps</button></div>
    </div>
  </>;
}

function Users({ data, edit, add }: { data: AdminData; edit: (u: AccessUser) => void; add: () => void }) {
  const [search, setSearch] = useState("");
  const filtered = data.users.filter((u) => `${u.email} ${u.displayName}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHead eyebrow="USER ACCESS" title="Users" description="Approve accounts and choose exactly which applications they can open." action={<button className="primary-button" onClick={add}><Plus size={17} />Add user</button>} />
    <div className="toolbar"><label className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users by name or email" /></label><span>{filtered.length} {filtered.length === 1 ? "user" : "users"}</span></div>
    <div className="table-card"><div className="table-row table-header"><span>User</span><span>Status</span><span>Application access</span><span>Updated</span><span /></div>{filtered.map((user) => { const count = Object.values(user.apps || {}).filter(Boolean).length; return <button className="table-row" key={user.email} onClick={() => edit(user)}><span className="user-cell"><Avatar name={user.displayName || user.email} /><span><strong>{user.displayName || "Unnamed user"}</strong><small>{user.email}</small></span></span><Status active={user.active} /><span className="access-count"><strong>{count}</strong> of {data.apps.length} apps</span><span className="muted">{formatDate(user.updatedAt)}</span><span className="edit-link">Edit</span></button>; })}{!filtered.length && <Empty icon={UsersRound} title={search ? "No users found" : "No approved users"} text={search ? "Try a different name or email." : "Add an email to begin assigning app access."} />}</div>
  </>;
}

function Apps({ apps, users, refresh, syncing }: { apps: WebApp[]; users: AccessUser[]; refresh: () => void; syncing: boolean }) {
  return <>
    <PageHead eyebrow="APP REGISTRY" title="Firebase web apps" description="Discovered securely from the Firebase Management API and kept available for assignments." action={<button className="secondary-button" onClick={refresh} disabled={syncing}><RefreshCw className={syncing ? "spin" : ""} size={17} />{syncing ? "Refreshing…" : "Refresh apps"}</button>} />
    <div className="app-grid">{apps.map((app) => { const count = users.filter((u) => u.active && u.apps?.[app.firebaseAppId]).length; return <article className="app-card" key={app.firebaseAppId}><div className="app-card-top"><span className="app-icon"><AppWindow size={21} /></span><Status active={app.active} label={app.active ? "Available" : "Unavailable"} /></div><h2>{app.displayName}</h2><p>{app.firebaseAppId}</p><div className="app-meta"><span><strong>{count}</strong> users with access</span><span>WEB</span></div></article>; })}{!apps.length && <div className="wide-empty"><Empty icon={Cloud} title="No web apps found" text="Refresh the registry or verify Firebase Management API access." /></div>}</div>
  </>;
}

function Admins({ admins, add, toggle }: { admins: AdminRecord[]; add: () => void; toggle: (a: AdminRecord) => void }) {
  return <>
    <PageHead eyebrow="ADMINISTRATION" title="Administrators" description="Only active administrators can view or change access settings." action={<button className="primary-button" onClick={add}><Plus size={17} />Add administrator</button>} />
    <div className="table-card"><div className="table-row admin-table table-header"><span>Administrator</span><span>Status</span><span>Added</span><span /></div>{admins.map((admin) => <div className="table-row admin-table" key={`${admin.pending}-${admin.id}`}><span className="user-cell"><Avatar name={admin.name || admin.email} /><span><strong>{admin.name || "Administrator"}</strong><small>{admin.email}</small></span></span><Status active={admin.active} label={admin.pending ? "Pending sign-in" : undefined} /><span className="muted">{formatDate(admin.createdAt)}</span><button className="small-button" onClick={() => toggle(admin)}>{admin.active ? "Disable" : "Enable"}</button></div>)}{!admins.length && <Empty icon={Shield} title="No administrators found" text="Bootstrap the first administrator in Firestore." />}</div>
    <div className="info-card"><Shield size={20} /><span><strong>Protected by server-side verification</strong>Every administrative request checks the caller’s current Firebase identity and active admin record. Interface controls alone are never trusted.</span></div>
  </>;
}

function UserModal({ initial, apps, close, save, remove, busy }: { initial: AccessUser | null; apps: WebApp[]; close: () => void; save: (u: AccessUser) => void; remove: (u: AccessUser) => void; busy: boolean }) {
  const [email, setEmail] = useState(initial?.email || "");
  const [displayName, setDisplayName] = useState(initial?.displayName || "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [selected, setSelected] = useState<Record<string, boolean>>(initial?.apps || {});
  const enabled = Object.values(selected).filter(Boolean).length;
  function submit(event: FormEvent) { event.preventDefault(); save({ id: initial?.id || "", email, displayName, role: "user", active, apps: selected }); }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}><form className="modal" onSubmit={submit}><div className="modal-head"><div><span className="eyebrow">{initial ? "EDIT USER" : "NEW USER"}</span><h2>{initial ? "Manage user access" : "Add approved user"}</h2></div><button type="button" className="icon-button" onClick={close}><X size={20} /></button></div><div className="form-grid"><label>Email address<input type="email" required disabled={!!initial} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label><label>Display name <small>Optional</small><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Full name" /></label></div><label className="status-control"><span><strong>Account status</strong><small>Globally allow or suspend this account</small></span><Toggle checked={active} onChange={setActive} /></label><div className="permission-head"><span><strong>Application access</strong><small>{enabled} of {apps.length} enabled</small></span><div><button type="button" onClick={() => setSelected(Object.fromEntries(apps.map((a) => [a.firebaseAppId, true])))}>Select all</button><button type="button" onClick={() => setSelected({})}>Clear all</button></div></div><div className="permission-list">{apps.map((app) => <label key={app.firebaseAppId}><span className="app-mini"><AppWindow size={17} /></span><span><strong>{app.displayName}</strong><small>{app.active ? "Firebase web app" : "Currently unavailable"}</small></span><Toggle checked={!!selected[app.firebaseAppId]} onChange={(checked) => setSelected((current) => ({ ...current, [app.firebaseAppId]: checked }))} /></label>)}</div><div className="modal-actions">{initial && <button type="button" className="danger-button" onClick={() => remove(initial)}><Trash2 size={16} />Delete user</button>}<span /><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}Save access</button></div></form></div>;
}

function AdminModal({ close, save, busy }: { close: () => void; save: (input: { email: string; name: string }) => void; busy: boolean }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}><form className="modal compact-modal" onSubmit={(e) => { e.preventDefault(); save({ email, name }); }}><div className="modal-head"><div><span className="eyebrow">ADMINISTRATOR</span><h2>Add administrator</h2><p>If the account has not used Firebase Authentication yet, the invitation will activate at first Google sign-in.</p></div><button type="button" className="icon-button" onClick={close}><X size={20} /></button></div><div className="form-stack"><label>Email address<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" /></label><label>Display name <small>Optional</small><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></label></div><div className="modal-actions"><span /><span /><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="primary-button" disabled={busy}>Add administrator</button></div></form></div>;
}

function Avatar({ name }: { name: string }) { return <span className="avatar">{name.trim().slice(0, 2).toUpperCase()}</span>; }
function Status({ active, label }: { active: boolean; label?: string }) { return <span className={`status ${active ? "positive" : "neutral"}`}><i />{label || (active ? "Active" : "Inactive")}</span>; }
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) { return <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>; }
function Empty({ icon: Icon, title, text }: { icon: typeof UsersRound; title: string; text: string }) { return <div className="empty"><span><Icon size={22} /></span><strong>{title}</strong><p>{text}</p></div>; }

export default App;
