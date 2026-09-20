import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import SearchPage from './pages/SearchPage';
import DashboardPage from './pages/DashboardPage';
import ProductDetailPage from './pages/ProductDetailPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<SearchPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
