const API='https://edu.std-900.ist.mospolytech.ru/exam-2024-1/api';
const API_KEY=localStorage.getItem('nordcart-api-key')||'';
const STORAGE={cart:'nordcart-cart',orders:'nordcart-local-orders'};
const $=selector=>document.querySelector(selector);
const state={goods:[],cart:read(STORAGE.cart,[])};
const demoGoods=[1,2,3,4,5,6].map(id=>({id,name:['Nordic Trail Backpack','Aurora Steel Bottle','Fjord Running Shoes','Lumen Desk Lamp','Polar Fleece Jacket','Boreal Travel Mug'][id-1],main_category:['sports & fitness','kitchen','sports & fitness','home','clothing','kitchen'][id-1],actual_price:1200+id*430,discount_price:id%2?900+id*300:null,rating:4+(id%2)/2,image_url:`https://images.unsplash.com/photo-${['1553062407-98eeb64c6a62','1602143407151-7111542de6e8','1542291026-7eec264c27ff','1507473885765-e6ed057f782c','1551028719-00167b16eac5','1514228742587-6b1558fcca3d'][id-1]}?auto=format&fit=crop&w=640&q=80`}));

function read(key,fallback){try{const value=JSON.parse(localStorage.getItem(key)||'null');return Array.isArray(value)?value:fallback}catch{return fallback}}
function write(key,value){localStorage.setItem(key,JSON.stringify(value))}
function notify(message){const box=$('#notice');if(!box)return;box.textContent=message;box.classList.add('show');setTimeout(()=>box.classList.remove('show'),5000)}
function price(good){return good.discount_price||good.actual_price}
function persistCart(){write(STORAGE.cart,state.cart);const count=$('#cartCount');if(count)count.textContent=String(state.cart.length)}
async function request(path,options={}){const separator=path.includes('?')?'&':'?';const response=await fetch(`${API}${path}${separator}api_key=${encodeURIComponent(API_KEY)}`,options);if(!response.ok)throw Error(`API ${response.status}`);return response.json()}

function card(good){const count=state.cart.filter(id=>id===good.id).length;return `<article class="card"><img src="${good.image_url}" alt="${good.name}" loading="lazy"><div class="card-body"><h3>${good.name}</h3><p class="rating">★ ${good.rating??'—'}</p><p class="price"><b>${price(good)} ₽</b></p><button data-add="${good.id}">${count?`В корзине: ${count} · добавить ещё`:'В корзину'}</button></div></article>`}
function renderCatalog(goods=state.goods){const box=$('#products');if(box)box.innerHTML=goods.length?goods.map(card).join(''):'<p class="empty">Нет товаров, соответствующих вашему запросу</p>';const categories=$('#categories');if(categories)categories.innerHTML=[...new Set(state.goods.map(good=>good.main_category))].sort().map(name=>`<label class="check"><input type="checkbox" value="${name}"> ${name}</label>`).join('');persistCart()}
async function loadGoods(){try{state.goods=await request('/goods?per_page=100')}catch{state.goods=demoGoods;notify('API временно недоступен — показаны демонстрационные товары')}renderCatalog()}
function setupCatalog(){if(!$('#products'))return;loadGoods();document.addEventListener('click',event=>{const id=Number(event.target.dataset.add);if(id){state.cart.push(id);renderCatalog()}})}

function renderCart(box,goods){const items=[...new Set(state.cart)].map(id=>goods.find(good=>good.id===id)).filter(Boolean);box.innerHTML=items.length?items.map(good=>{const count=state.cart.filter(id=>id===good.id).length;return `<article class="cart-row"><img src="${good.image_url}" alt="${good.name}"><span>${good.name}<small>Количество: ${count}</small></span><b>${price(good)*count} ₽</b><button type="button" data-remove-one="${good.id}">− 1</button><button type="button" data-remove="${good.id}">Удалить всё</button></article>`}).join(''):'<p class="empty">Корзина пуста. Перейдите в каталог.</p>';persistCart()}
function localOrder(data){const order={...data,id:`local-${Date.now()}`,created_at:new Date().toISOString(),local:true};const orders=read(STORAGE.orders,[]);orders.unshift(order);write(STORAGE.orders,orders);return order}
function clearCart(form,box,goods){state.cart=[];persistCart();form.reset();renderCart(box,goods)}
async function setupCart(){
  const box=$('#cartItems'),form=$('#orderForm');if(!box||!form)return;
  let goods;try{goods=await request('/goods?per_page=100')}catch{goods=demoGoods;notify('API временно недоступен — показана локальная корзина')}
  form.elements.delivery_date.min=new Date().toISOString().slice(0,10);
  renderCart(box,goods);
  document.addEventListener('click',event=>{const one=Number(event.target.dataset.removeOne),all=Number(event.target.dataset.remove);if(one){const index=state.cart.indexOf(one);if(index>=0)state.cart.splice(index,1);renderCart(box,goods)}if(all){state.cart=state.cart.filter(id=>id!==all);renderCart(box,goods)}});
  form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;if(!state.cart.length){notify('Добавьте товары в корзину');return}const data=Object.fromEntries(new FormData(form));data.subscribe=Boolean(data.subscribe);data.good_ids=[...state.cart];try{await request('/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});clearCart(form,box,goods);notify('Заказ оформлен')}catch{localOrder(data);clearCart(form,box,goods);notify('API недоступен — заказ сохранён локально')}});
}

function renderOrders(box,orders){box.innerHTML=orders.length?`<table><thead><tr><th>№</th><th>Дата</th><th>Состав</th><th>Доставка</th><th>Действия</th></tr></thead><tbody>${orders.map(order=>`<tr><td>${order.id}</td><td>${new Date(order.created_at).toLocaleString('ru-RU')}</td><td>${order.good_ids.join(', ')}</td><td>${order.delivery_date}, ${order.delivery_interval}</td><td><button data-view="${order.id}">Просмотр</button> <button data-delete="${order.id}">Удалить</button></td></tr>`).join('')}</tbody></table>`:'<p class="empty">Заказов пока нет.</p>'}
function modal(order){const old=$('#orderModal');old?.remove();const view=document.createElement('div');view.id='orderModal';view.className='modal-backdrop';view.innerHTML=`<section class="modal"><button class="modal-close">×</button><h2>Заказ №${order.id}</h2><p>${order.local?'Сохранён локально в этом браузере':'Оформлен'}</p><p>Доставка: ${order.delivery_date}, ${order.delivery_interval}</p><p>Товары: ${order.good_ids.join(', ')}</p></section>`;document.body.append(view);view.querySelector('.modal-close').onclick=()=>view.remove()}
async function setupOrders(){const box=$('#orders');if(!box)return;let orders;try{orders=await request('/orders')}catch{orders=read(STORAGE.orders,[])}renderOrders(box,orders);document.addEventListener('click',event=>{const view=event.target.dataset.view,remove=event.target.dataset.delete;if(view){const order=read(STORAGE.orders,[]).find(item=>String(item.id)===view);if(order)modal(order)}if(remove){const orders=read(STORAGE.orders,[]).filter(item=>String(item.id)!==remove);write(STORAGE.orders,orders);renderOrders(box,orders)}})}

setupCatalog();
setupCart();
setupOrders();
