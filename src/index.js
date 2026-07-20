import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Shop from './shop/Shop'

// Routing:
//   bricksandjoy.com/backoffice…  → the admin back office (login required)
//   everything else               → the public website / shop
const path = window.location.pathname.replace(/\/+$/, '').toLowerCase()
const isBackoffice = path === '/backoffice' || path.startsWith('/backoffice/')

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(<React.StrictMode>{isBackoffice ? <App /> : <Shop />}</React.StrictMode>)
