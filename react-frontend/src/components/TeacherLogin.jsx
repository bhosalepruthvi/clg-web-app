import { appFetch } from '../lib/transport';
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { IconAlert, IconArrowLeft, IconArrowRight, IconCheck } from './icons';

function SecretInput({ label, className = '', ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} aria-label={label} className={`${className} pr-20`} />
      <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible}
        onClick={() => setVisible(value => !value)}
        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-2 text-xs font-bold text-indigo-700 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export default function TeacherLogin() {
  const [isRegister, setIsRegister] = useState(false);
  const [inviteCode,setInviteCode]=useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (isRegister) {
      if (!name.trim()) {
        setError('Full Name is required.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = isRegister ? '/api/auth/teacher/register' : '/api/auth/teacher/login';
      const bodyPayload = isRegister
        ? { name: name.trim(), email: email.trim(), password, invite_code:inviteCode }
        : { email: email.trim(), password };

      const response = await appFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await response.json();

      if (response.ok) {
        if (isRegister) {
          setSuccessMsg('Account created successfully! Please sign in with your credentials.');
          setIsRegister(false);
          setPassword('');
          setConfirmPassword('');
        } else if (data.token) {
          localStorage.setItem('studyflow_jwt', data.token);
          localStorage.setItem('studyflow_token', data.token);
          localStorage.setItem('studyflow_role', 'teacher');
          localStorage.setItem('studyflow_user', JSON.stringify(data.user));
          navigate('/teacher-dashboard');
        }
      } else {
        setError(data.error || (isRegister ? 'Registration failed.' : 'Invalid teacher credentials.'));
      }
    } catch (err) {
      setError('Network connection failed. Please ensure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-indigo-50 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl shadow-indigo-100 overflow-hidden border border-indigo-200/70">
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white text-center">
          <Link to="/" className="text-xs text-indigo-100 hover:text-white mb-2 inline-flex items-center gap-1">
            <IconArrowLeft className="w-3.5 h-3.5" /> Back to Role Choice
          </Link>
          <h2 className="text-2xl font-black">{isRegister ? 'Faculty Registration' : 'Faculty Portal'}</h2>
          <p className="text-xs text-indigo-100 mt-1">
            {isRegister ? 'Create your new instructor account' : 'Sign in with your faculty email and password'}
          </p>
        </div>

        {/* Tab switch between Sign In and Register */}
        <div className="flex border-b border-slate-100 bg-slate-50/70 p-1">
          <button
            type="button"
            onClick={() => { setIsRegister(false); setError(''); setSuccessMsg(''); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              !isRegister ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setIsRegister(true); setError(''); setSuccessMsg(''); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              isRegister ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium flex items-center gap-2">
              <IconAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl font-medium flex items-center gap-2">
              <IconCheck className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {isRegister && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. Jane Smith"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prof@college.edu"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Password
            </label>
            <SecretInput
              label="Password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
            {isRegister && (
              <p className="text-[10px] text-slate-400 mt-1">Must be at least 8 characters.</p>
            )}
          </div>

          {isRegister && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Confirm Password
              </label>
              <SecretInput
                label="Confirm password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
          )}

          {isRegister&&<div className="block text-sm font-bold">Faculty invitation code<SecretInput label="Faculty invitation code" autoComplete="off" value={inviteCode} onChange={e=>setInviteCode(e.target.value)} className="w-full p-3 mt-2 border border-slate-300 rounded-xl"/><span className="text-xs text-slate-500">Private registration code provided by your college administrator. This is separate from your password.</span></div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/25 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              'Processing...'
            ) : isRegister ? (
              <>
                <span>Complete Registration</span>
                <IconCheck className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <IconArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        <details className="text-sm mt-4"><summary>Forgot password?</summary><p>Contact your college administrator to verify your identity and issue a new password. After signing in, use Change password.</p></details></form>
      </div>
    </div>
  );
}
