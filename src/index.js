import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Shop from './shop/Shop'

// The public storefront lives at /shop and needs no login; every other path is
// the admin app.
const isShop = window.location.pathname.replace(/\/+$/, '').toLowerCase().startsWith('/shop')

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(<React.StrictMode>{isShop ? <Shop /> : <App />}</React.StrictMode>)
