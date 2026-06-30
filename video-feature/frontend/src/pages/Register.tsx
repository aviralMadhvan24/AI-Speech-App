/**
 * Register page (Task 10, Requirement 1.1).
 *
 * Collects name, email, password, and a role (student/teacher), calls the auth
 * context's `register`, then logs the user in and routes them to their role
 * landing page. Field-level validation errors from the backend (`details`) are
 * surfaced inline; duplicate-email (409) and other errors show a banner.
 */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../auth/token';
import { ApiError } from '../api/client';
import { AuthShell, Field } from './Login';

export function Register(): JSX.Element {
  const { register, login } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register({ name, email, password, role });
      // Registration succeeded; log in to obtain a token and route by role.
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setFieldErrors(err.details);
        setError(err.message);
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Create an account" subtitle="Join Mock Interview as a student or teacher.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Field label="Name" type="text" value={name} autoComplete="name" onChange={setName} required />
          {fieldErrors.name && <FieldError message={fieldErrors.name} />}
        </div>
        <div>
          <Field label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} required />
          {fieldErrors.email && <FieldError message={fieldErrors.email} />}
        </div>
        <div>
          <Field
            label="Password"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={setPassword}
            required
          />
          {fieldErrors.password && <FieldError message={fieldErrors.password} />}
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">I am a</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
          </select>
          {fieldErrors.role && <FieldError message={fieldErrors.role} />}
        </label>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-brand px-4 py-2 font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}

/** Small inline field-level error message. */
function FieldError({ message }: { message: string }): JSX.Element {
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}
