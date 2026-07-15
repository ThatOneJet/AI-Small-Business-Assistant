import axios from 'axios'

const BASE = import.meta.env.DEV ? 'http://localhost:5000' : ''

const client = axios.create({ baseURL: BASE, timeout: 600000 })

client.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

export const api = {
  post: (path, data)        => client.post(path, data),
  get:  (path, params)      => client.get(path, { params }),
  put:  (path, data)        => client.put(path, data),
  del:  (path)              => client.delete(path),
}
