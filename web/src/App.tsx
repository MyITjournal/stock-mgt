import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { SignInPage } from './auth/SignInPage';
import { Layout, Page } from './components/Layout';
import { ApiError } from './api/client';
import { HomePage } from './home/HomePage';
import { TillPage } from './till/TillPage';
import { SalesPage } from './sales/SalesPage';
import { SaleDetailPage } from './sales/SaleDetailPage';
import { CustomersPage } from './customers/CustomersPage';
import { CustomerDetailPage } from './customers/CustomerDetailPage';
import { MoneyLayout } from './money/MoneyLayout';
import { ReceivablesPage } from './money/ReceivablesPage';
import { PaymentsPage } from './money/PaymentsPage';
import { BankAccountsPage } from './money/BankAccountsPage';
import { PayablesPage } from './money/PayablesPage';
import { ExpensesPage } from './money/ExpensesPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The client already retried once behind a refreshed session. Retrying a
      // 401, 403 or 409 again would only repeat a decision the server has
      // already made — and a 409 here is a rule, not a glitch.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Routes through slice 7.3.
 *
 * Signing in, home, the till, sales and customers are real; the rest of the map
 * is laid out so the navigation is honest about what is coming, and so each
 * later slice drops its screens into a route that already exists.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/sign-in" element={<SignInPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="till" element={<TillPage />} />
                <Route path="sales" element={<SalesPage />} />
                <Route path="sales/:id" element={<SaleDetailPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="customers/:id" element={<CustomerDetailPage />} />
                <Route path="money" element={<MoneyLayout />}>
                  <Route index element={<ReceivablesPage />} />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="payables" element={<PayablesPage />} />
                  <Route path="expenses" element={<ExpensesPage />} />
                  <Route path="accounts" element={<BankAccountsPage />} />
                </Route>
                <Route
                  path="stock"
                  element={<ComingSoon title="Stock" slice="7.5" />}
                />
                <Route
                  path="reports"
                  element={<ComingSoon title="Reports" slice="7.6" />}
                />
                <Route
                  path="settings"
                  element={<ComingSoon title="Settings" slice="7.6" />}
                />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ComingSoon({ title, slice }: { title: string; slice: string }) {
  return (
    <Page title={title} description={`Lands in slice ${slice}.`}>
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
        Not built yet.
      </div>
    </Page>
  );
}
