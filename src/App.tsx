import { useState } from 'react'
import { PhoneShell } from './components/PhoneShell'
import { StoreProvider, useStore } from './lib/store'
import { HeartRateProvider } from './hooks/useHeartRateMonitor'
import { Avatar } from './pages/Avatar'
import { Home } from './pages/Home'
import { Inventory } from './pages/Inventory'
import { Summary } from './pages/Summary'
import { Workout } from './pages/Workout'
import type { Route, WorkoutSession } from './types'

function Product() {
  const [route,setRoute]=useState<Route>('home'),[result,setResult]=useState<WorkoutSession|null>(null)
  const {finishWorkout}=useStore()
  const finish=(session:WorkoutSession)=>{setResult(finishWorkout(session));setRoute('summary')}
  return <PhoneShell route={route} go={setRoute} hideNav={route==='workout'||route==='summary'}>{route==='home'&&<Home start={()=>setRoute('workout')}/>} {route==='workout'&&<Workout back={()=>setRoute('home')} finish={finish}/>} {route==='summary'&&result&&<Summary result={result} avatar={()=>setRoute('avatar')} home={()=>setRoute('home')}/>} {route==='avatar'&&<Avatar inventory={()=>setRoute('inventory')}/>} {route==='inventory'&&<Inventory/>}</PhoneShell>
}
export default function App(){return <HeartRateProvider><StoreProvider><Product/></StoreProvider></HeartRateProvider>}
