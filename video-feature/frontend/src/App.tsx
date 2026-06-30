/**
 * Application shell + routing (Task 10).
 *
 * Wires up React Router with:
 *   - public `/login` and `/register` pages,
 *   - role-guarded `/student` and `/teacher` landing pages (via `RoleRoute`),
 *   - an index route that sends authenticated users to their role's home and
 *     unauthenticated users to login.
 *
 * The server remains the source of truth for authorization; `RoleRoute` is
 * client-side defense-in-depth (Requirements 1.5, 1.6).
 */

import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RoleRoute } from './routes/RoleRoute';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { StudentHome } from './pages/StudentHome';
import { TeacherHome } from './pages/TeacherHome';
import { Leaderboard } from './pages/Leaderboard';

/** Routes the index path based on auth state + role. */
function HomeRedirect(): JSX.Element {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={role === 'teacher' ? '/teacher' : '/student'} replace />;
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Student-only area */}
      <Route element={<RoleRoute allow="student" />}>
        <Route path="/student" element={<StudentHome />} />
      </Route>

      {/* Teacher-only area */}
      <Route element={<RoleRoute allow="teacher" />}>
        <Route path="/teacher" element={<TeacherHome />} />
      </Route>

      {/* Leaderboard: reachable by any authenticated user (student or teacher) */}
      <Route element={<RoleRoute />}>
        <Route path="/leaderboard" element={<Leaderboard />} />
      </Route>

      {/* Unknown paths fall back to the index redirect. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
