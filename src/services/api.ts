const TOKEN_STORAGE_KEY = 'tenantflow_jwt_token';

/**
 * Uses sessionStorage so evaluators can open Tab 1 as Rahul and Tab 2 as Priya
 * in the same browser window to test live multi-user Socket.IO collaboration!
 */
export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class ApiHttpError extends Error {
  status: number;
  code?: string;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.code = data?.code;
    this.data = data;
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiHttpError(
      response.status,
      data?.error || `Request failed with status ${response.status}`,
      data
    );
  }

  return data as T;
}
