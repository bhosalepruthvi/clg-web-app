import { appFetch } from '../lib/transport';
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function StudentLogin() {
 const navigate=useNavigate();
 const [register,setRegister]=useState(false),[email,setEmail]=useState(''),[code,setCode]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function submit(e){
  e.preventDefault();setError('');setMessage('');
  if(register&&password!==confirm)return setError('Passwords do not match.');
  setBusy(true);
  try {
   const body=register?{email,code,password}:email.includes('@')?{email,password}:{access_code:email,password};
   const response=await appFetch('/api/auth/student/'+(register?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not sign in.');
   if(register){setRegister(false);setPassword('');setConfirm('');setCode('');setMessage('Account created. Sign in with your email and password.');return;}
   if(data.requires_password_change)throw new Error('Ask your teacher to reissue a registration code, then use Create Account.');
   if(!data.token)throw new Error('Sign-in did not complete. Please try again.');
   localStorage.setItem('studyflow_jwt',data.token);localStorage.setItem('studyflow_token',data.token);localStorage.setItem('studyflow_role','student');localStorage.setItem('studyflow_student',JSON.stringify(data.student));navigate('/student-dashboard');
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const inputClass='mt-2 w-full rounded-xl border border-slate-300 p-3 bg-white text-slate-900';
 return <div className="min-h-screen flex items-center justify-center bg-indigo-50 p-4"><section className="paper-card w-full max-w-lg"><Link to="/">← Choose role</Link><h1>Student Portal</h1><div className="segmented my-4">{[false,true].map(value=><button key={String(value)} type="button" aria-pressed={register===value} onClick={()=>{setRegister(value);setError('');setMessage('');setPassword('');setConfirm('');}}>{value?'Create Account':'Sign In'}</button>)}</div>
 {error&&<p role="alert" className="error-card">{error}</p>}{message&&<p role="status" className="success-note">{message}</p>}
 <form onSubmit={submit} className="space-y-4">
 <label className="block">{register?'Email address':'Email or existing student code'}<input className={inputClass} required type={register?'email':'text'} autoComplete="username" maxLength={255} value={email} onChange={e=>setEmail(e.target.value)}/></label>
 {register&&<label className="block">Registration code from your teacher<input className={inputClass} required aria-label="Registration code from your teacher" placeholder="STU-…" autoComplete="off" maxLength={40} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/><small>This private code links your account to your student record.</small></label>}
 <label className="block">Password<input className={inputClass} required type={visible?'text':'password'} autoComplete={register?'new-password':'current-password'} minLength={register?10:1} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)}/></label>
 {register&&<label className="block">Confirm password<input className={inputClass} required type={visible?'text':'password'} autoComplete="new-password" maxLength={72} aria-label="Confirm password" value={confirm} onChange={e=>setConfirm(e.target.value)}/><small>Use at least 10 characters.</small></label>}
 <button type="button" className="secondary-btn" aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?'Hide':'Show'} password</button><button className="primary-btn w-full" disabled={busy}>{busy?'Please wait…':register?'Create Account':'Sign In'}</button>
 </form><details className="mt-4"><summary>Forgot password?</summary><p>Contact your teacher to verify your identity and reissue a private registration code. Use Create Account with that code to choose your password again. Your student record and attendance are preserved.</p></details></section></div>;
}
