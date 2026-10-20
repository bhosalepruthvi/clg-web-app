import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { IconAlert, IconArrowLeft, IconArrowRight, LogoMark } from './icons';

export default function StudentLogin() {
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    const formattedCode = accessCode.trim().toUpperCase();
    if (!formattedCode) {
      setError('Please enter your Division Access Code.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/student/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: formattedCode }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // Save the returned JWT in localStorage as required
        localStorage.setItem('studyflow_jwt', data.token);
        localStorage.setItem('studyflow_token', data.token);
        localStorage.setItem('studyflow_role', 'student');
        if (data.student) {
          localStorage.setItem('studyflow_student', JSON.stringify(data.student));
        }

        // Redirect Student to /student-dashboard
        navigate('/student-dashboard');
      } else {
        setError(data.error || 'Invalid Division Access Code. Please check with your teacher.');
      }
    } catch (err) {
      setError('Unable to connect to server. Please verify the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-indigo-50 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl shadow-indigo-100 overflow-hidden border border-indigo-200/70">

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-8 text-white text-center">
          <Link
            to="/"
            className="text-xs text-indigo-100 hover:text-white mb-3 inline-flex items-center gap-1 font-semibold transition-colors"
          >
            <IconArrowLeft className="w-3.5 h-3.5" /> Choose Role
          </Link>
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center">
            <LogoMark className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">Student Portal</h1>
          <p className="text-indigo-100 text-sm mt-1 font-medium">
            No password needed &bull; Instant access via your unique code
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="p-8 sm:p-10 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-medium flex items-center gap-2">
              <IconAlert className="w-4 h-4 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-center">
            <label
              htmlFor="accessCodeInput"
              className="block text-xs font-extrabold uppercase tracking-widest text-slate-500 mb-3"
            >
              Division Access Code
            </label>

            {/* Single Massive Input Field */}
            <input
              id="accessCodeInput"
              type="text"
              required
              autoFocus
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
              placeholder="FE-E-E1-36"
              className="w-full py-5 px-4 text-center text-3xl sm:text-4xl font-mono font-black tracking-wider text-indigo-950 bg-slate-50 border-2 border-slate-300 rounded-2xl focus:outline-none focus:border-indigo-600 focus:bg-white focus:ring-4 focus:ring-indigo-100 transition-all uppercase placeholder:text-slate-300 shadow-inner"
            />

            <p className="text-xs text-slate-500 mt-3 font-medium">
              Examples: <span className="font-mono font-semibold text-slate-700">FE-E-E1-36</span> (Common FE) or{' '}
              <span className="font-mono font-semibold text-slate-700">SE-CE-A-A1-12</span>
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-base rounded-2xl shadow-xl shadow-indigo-600/25 hover:shadow-indigo-600/40 transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span>Authenticating...</span>
            ) : (
              <>
                <span>Access Coursework & Materials</span>
                <IconArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="bg-indigo-50/50 px-8 py-4 border-t border-indigo-100 text-center text-xs text-slate-500">
          Need an access code? Contact your branch class coordinator or subject faculty.
        </div>
      </div>
    </div>
  );
}
