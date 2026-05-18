import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

// Premium smooth scroll with momentum & deceleration
const lenis = new Lenis({
  duration: 1.4,         // scroll duration — higher = heavier feel
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // exponential ease-out
  orientation: 'vertical',
  gestureOrientation: 'vertical',
  smoothWheel: true,
  wheelMultiplier: 0.9,  // slightly under 1 = weighted resistance
  touchMultiplier: 1.6,  // mobile swipes feel snappy
  infinite: false,
})

function raf(time) {
  lenis.raf(time)
  requestAnimationFrame(raf)
}
requestAnimationFrame(raf)

// Expose lenis globally so App.jsx can use scrollTo with physics
window.__lenis = lenis

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
