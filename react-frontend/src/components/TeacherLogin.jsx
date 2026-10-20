import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { IconAlert, IconArrowLeft, IconArrowRight } from './icons';

export default function TeacherLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // Save the returned JWT in localStorage as required
        localStorage.setItem('studyflow_jwt', data.token);
        localStorage.setItem('studyflow_token', data.token);
        localStorage.setItem('studyflow_role', 'teacher');
        localStorage.setItem('studyflow_user', JSON.stringify(data.user));

        // Redirect Teacher to /teacher-dashboard
        navigate('/teacher-dashboard');
      } else {
        setError(data.error || 'Invalid teacher credentials.');
      }
    } catch (err) {
      setError('Network connection failed. Please ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-indigo-50 flex flex-col justify-center items-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl shadow-indigo-100 overflow-hidden border border-indigo-200/70">
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white text-center">
          <Link to="/" className="text-xs text-indigo-100 hover:text-white mb-2 inline-flex items-center gap-1">
            <IconArrowLeft className="w-3.5 h-3.5" /> Back to Role Choice
          </Link>
          <h2 className="text-2xl font-black">Faculty Portal</h2>
          <p className="text-xs text-indigo-100 mt-1">Sign in with your faculty email and password</p>
        </div>

        <form onSubmit={handleLogin} className="p-8 space-y-5">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium flex items-center gap-2">
              <IconAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
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
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/25 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              'Authenticating...'
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <IconArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
