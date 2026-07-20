async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Er ging iets mis.");
  }
  return data;
}

export const api = {
  login(email, password) {
    return request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  register(name, email, password) {
    return request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });
  },
  flights(token) {
    return request("/flights", { token });
  },
  createFlight(token, flight) {
    return request("/flights", {
      method: "POST",
      token,
      body: JSON.stringify(flight)
    });
  },
  refreshFlight(token, id) {
    return request(`/flights/${id}/refresh`, {
      method: "POST",
      token
    });
  },
  archiveFlight(token, id) {
    return request(`/flights/${id}/archive`, {
      method: "PATCH",
      token
    });
  },
  deleteFlight(token, id) {
    return request(`/flights/${id}`, {
      method: "DELETE",
      token
    });
  }
};
