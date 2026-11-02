import React, { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Lock, ShieldCheck, Users } from 'lucide-react';
import { apiRequest } from '../services/api.ts';
import type { DemoAccount, Organization, User } from '../types.ts';

interface AuthScreenProps {
  onAuthenticated: (payload: { token: string; user: User; organizations: Organization[] }) => void;
  onOpenPublicDocs: () => void;
}

export function AuthScreen({ onAuthenticated, onOpenPublicDocs }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('rahul@abctech.in');
  const [password, setPassword] = useState('Password@123');
  const [confirmPassword, setConfirmPassword] = useState('Password@123');
  const [organizationName, setOrganizationName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => {
    apiRequest<{ accounts: DemoAccount[] }>('/api/demo/accounts')
      .then((res) => setDemoAccounts(res.accounts || []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        onAuthenticated(res);
      } else {
        const res = await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name,
            email,
            password,
            organizationName: organizationName.trim() || undefined,
            branchName: branchName.trim() || undefined,
          }),
        });
        onAuthenticated(res);
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickSignIn(account: DemoAccount) {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: account.email, password: account.password }),
      });
      onAuthenticated(res);
    } catch (err: any) {
      setError(err?.message || 'Quick login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 lg:px-10 py-4 bg-white border-b border-slate-200">
        <a href="#top" className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          TenantFlow
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a href="#personas" className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0">
            Demo Personas
          </a>
          <a href="#architecture" className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0">
            Architecture
          </a>
          <button
            type="button"
            onClick={onOpenPublicDocs}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            ER Diagram
          </button>
          <button
            type="button"
            onClick={onOpenPublicDocs}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            API &amp; Docs
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenPublicDocs}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>View Submission Docs</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1320px] w-full mx-auto px-6 lg:px-10 py-10 lg:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          {/* Left Column: Multi-Tenant Context + Instant Persona Sign-In */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <p className="text-xs font-medium text-slate-500">
                Multi-Organization · Branch-Isolated · Real-Time Socket.IO
              </p>
              <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 max-w-2xl">
                Collaborative task execution with strict branch-level tenant isolation.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                Built for distributed organizations like ABC Technologies (Hyderabad, Bangalore, Chennai) and XYZ Solutions (Mumbai, Pune). Every board, column, task, WebSocket room, and audit log enforces SQL tenant authorization and optimistic version locking.
              </p>
            </div>

            {/* Instant Evaluator Persona Table */}
            <section id="personas" className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    One-Click Evaluation Personas
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tip: Open two browser tabs and sign in as Rahul (Tab 1) and Priya (Tab 2) to test live Socket.IO sync.
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap">
                  Password@123
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {demoAccounts.map((acc) => (
                  <div
                    key={acc.email}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 px-2 -mx-2 rounded-lg transition-colors"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="truncate">{acc.name}</span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-xs font-mono font-normal text-slate-500 truncate">
                          {acc.email}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-medium text-slate-700">{acc.organization}</span>
                        <span aria-hidden="true">·</span>
                        <span>{acc.branch}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-blue-700 font-medium">{acc.role}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleQuickSignIn(acc)}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <span>Sign in as {acc.name.split(' ')[0]}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Core Architecture Proof Row */}
            <section id="architecture" className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>SQL Tenant Isolation</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  8 relational tables scoped by <code className="font-mono text-slate-800">tenant_id</code>; cross-branch queries return HTTP 403.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Users className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Scoped Socket.IO Rooms</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Server-verified <code className="font-mono text-slate-800">tenant:TEN001</code> rooms with multi-tab presence tracking.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Lock className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Optimistic Locking (409)</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Every task write verifies <code className="font-mono text-slate-800">expectedVersion</code> inside an ACID SQL transaction.
                </p>
              </div>
            </section>
          </div>

          {/* Right Column: Login & Registration Form */}
          <div className="lg:col-span-5 flex">
            <div className="w-full bg-white border border-slate-200 rounded-xl p-6 lg:p-8 flex flex-col justify-between">
              <div className="space-y-6">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className={`flex-1 py-2 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      mode === 'login'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setEmail('');
                      setPassword('');
                      setConfirmPassword('');
                      setError(null);
                    }}
                    className={`flex-1 py-2 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      mode === 'register'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {mode === 'login' ? 'Sign in to your workspace' : 'Register an employee account'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {mode === 'login'
                      ? 'Enter your credentials or select a demo persona on the left.'
                      : 'Create a new user account or provision a fresh organization.'}
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium"
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {mode === 'register' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Ananya Verma"
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Work Email
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="rahul@abctech.in"
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                    />
                  </div>

                  {mode === 'register' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Confirm Password
                        </label>
                        <input
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                        />
                      </div>

                      <div className="pt-2 border-t border-slate-100 space-y-3">
                        <p className="text-xs text-slate-500">
                          Optional: Create a new Organization (leave blank to join ABC Technologies · Hyderabad as Member)
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <input
                            type="text"
                            value={organizationName}
                            onChange={(e) => setOrganizationName(e.target.value)}
                            placeholder="Organization Name"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                          <input
                            type="text"
                            value={branchName}
                            onChange={(e) => setBranchName(e.target.value)}
                            placeholder="Branch (e.g. Delhi)"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {loading
                      ? 'Authenticating...'
                      : mode === 'login'
                      ? 'Sign In to Workspace'
                      : 'Create Account & Continue'}
                  </button>
                </form>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>JWT HS256 · bcrypt (cost 10)</span>
                <button
                  type="button"
                  onClick={onOpenPublicDocs}
                  className="text-blue-600 hover:text-blue-800 font-medium hover:underline cursor-pointer whitespace-nowrap"
                >
                  Read Architecture &amp; API Docs
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
