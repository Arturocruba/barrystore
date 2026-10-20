// ==============================================
// CONFIGURACIÓN
// ==============================================
const SUPABASE_URL = "https://krexhlskqyyoltuenmgy.supabase.co";
const SUPABASE_KEY = "sb_publishable_l57Ekm_BMXOIcy27niKuNg_hkzYhjP4";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// La clave de Gemini YA NO va aquí: vive como "secret" en la Edge Function "barry-ia" de Supabase.
const FUNCION_IA = "barry-ia";

const MARGEN_DEFAULT = 0.30;   // margen para productos nuevos (30%)
const CIUDAD = "México";       // pon tu ciudad para que la búsqueda de precios sea más precisa
const FOTO_VACIA = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="#f1f3f5"/><text x="45" y="50" font-size="11" text-anchor="middle" fill="#868e96" font-family="sans-serif">Sin foto</text></svg>'
);

// ==============================================
// UTILIDADES
// ==============================================
const $ = (id) => document.getElementById(id);
const dinero = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const redondearMedio = (n) => Math.ceil(n * 2) / 2; // redondea hacia arriba a $0.50
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function alerta(el, tipo, html) {
  el.innerHTML = `<div class="alert alert-${tipo} py-2 mb-0">${html}</div>`;
}

// Llama a la Edge Function que habla con Gemini
async function llamarIA(accion, datos) {
  const { data, error } = await db.functions.invoke(FUNCION_IA, { body: { accion, ...datos } });
  if (error) {
    let msg = error.message;
    try { const ctx = await error.context.json(); msg = ctx.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Precio sugerido respetando el margen que ya tenía el producto
function precioSugerido(costoNuevo, prodLocal) {
  if (!prodLocal) return redondearMedio(costoNuevo * (1 + MARGEN_DEFAULT));
  const costoAnt = parseFloat(prodLocal.costo_compra) || 0;
  const precioAct = parseFloat(prodLocal.precio_venta) || 0;
  const margen = costoAnt > 0 && precioAct > costoAnt ? precioAct / costoAnt - 1 : MARGEN_DEFAULT;
  const sugerido = redondearMedio(costoNuevo * (1 + margen));
  // Nunca baja el precio automáticamente; solo sube si hace falta
  return Math.max(precioAct, sugerido);
}

// ==============================================
// NAVEGACIÓN ENTRE PESTAÑAS
// ==============================================
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => abrirTab(btn.dataset.tab));
});

function abrirTab(idSeccion) {
  apagarCamaraCaja();
  document.querySelectorAll(".seccion").forEach(s => s.style.display = s.id === idSeccion ? "block" : "none");
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.className = `tab-btn btn ${b.dataset.tab === idSeccion ? "btn-primary" : "btn-outline-primary"} fw-bold px-3`;
  });
  if (idSeccion === "seccionVentas") resetFocus();
  if (idSeccion === "seccionCatalogo") { $("codigoInput").focus(); cargarListaCatalogo(); }
  if (idSeccion === "seccionPrecios") { cargarListaProductos(); cargarFeedPrecios(); }
  if (idSeccion === "seccionReporte") cargarReporte();
}

// ==============================================
// 1. COBRO Y VENTAS (POS)
// ==============================================
let carrito = [];
const barcodeInput = $("barcodeInput");
const scanStatus = $("scanStatus");
const cartItems = $("cartItems");
const pagoInput = $("pagoInput");
const cambioText = $("cambioText");
const btnCobrar = $("btnCobrar");

function resetFocus() {
  barcodeInput.value = "";
  barcodeInput.focus();
}

barcodeInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const code = barcodeInput.value.trim();
    if (code) await agregarProductoPorCodigo(code);
  }
});

async function agregarProductoPorCodigo(code) {
  scanStatus.innerHTML = `<span class="text-primary">Buscando producto...</span>`;
  const { data: prod } = await db.from("productos").select("*").eq("codigo_barras", code).maybeSingle();

  if (!prod) {
    scanStatus.innerHTML = `<span class="text-danger fw-bold">Producto no encontrado. Regístralo en "Catálogo".</span>`;
    resetFocus();
    return;
  }

  agregarItem({
    codigo: prod.codigo_barras,
    nombre: prod.nombre,
    precio: parseFloat(prod.precio_venta),
    costo: parseFloat(prod.costo_compra) || 0
  });

  scanStatus.innerHTML = `<span class="text-success fw-bold">Agregado: ${esc(prod.nombre)}</span>`;
  actualizarVistaCarrito();
  resetFocus();
}

window.cambiarCantidad = function (index, delta) {
  carrito[index].cantidad += delta;
  if (carrito[index].cantidad <= 0) carrito.splice(index, 1);
  actualizarVistaCarrito();
};

window.eliminarFila = function (index) {
  carrito.splice(index, 1);
  actualizarVistaCarrito();
};

const totalCarrito = () => carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0);

function actualizarVistaCarrito() {
  if (carrito.length === 0) {
    cartItems.innerHTML = `
      <tr><td colspan="5" class="text-center py-5 vacio">
        <svg class="abeja-xl"><use href="#abeja"/></svg>
        <div>El carrito está vacío. Escanea un artículo para comenzar.</div>
      </td></tr>`;
    $("totalText").textContent = "$0.00";
    $("itemCount").textContent = "0 artículos";
    btnCobrar.disabled = true;
    pagoInput.value = "";
    cambioText.textContent = "$0.00";
    return;
  }

  cartItems.innerHTML = carrito.map((item, idx) => `
    <tr>
      <td><strong>${esc(item.nombre)}</strong><br><small class="text-muted">${esc(item.codigo)}</small></td>
      <td class="text-center">
        <div class="d-flex align-items-center justify-content-center gap-1">
          <button class="btn btn-sm btn-outline-secondary btn-qty" onclick="cambiarCantidad(${idx}, -1)">-</button>
          <span class="fw-bold px-2">${item.cantidad}</span>
          <button class="btn btn-sm btn-outline-secondary btn-qty" onclick="cambiarCantidad(${idx}, 1)">+</button>
        </div>
      </td>
      <td class="text-end">${dinero(item.precio)}</td>
      <td class="text-end fw-bold">${dinero(item.precio * item.cantidad)}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-danger" onclick="eliminarFila(${idx})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join("");

  const total = totalCarrito();
  $("totalText").textContent = dinero(total);
  $("itemCount").textContent = `${carrito.reduce((a, i) => a + i.cantidad, 0)} piezas`;
  btnCobrar.disabled = false;
  calcularCambio();
}

function calcularCambio() {
  const total = totalCarrito();
  const recibido = parseFloat(pagoInput.value) || 0;
  if (recibido >= total && total > 0) {
    cambioText.textContent = dinero(recibido - total);
    cambioText.className = "fs-3 fw-bold text-success";
  } else {
    cambioText.textContent = recibido > 0 ? `Faltan ${dinero(total - recibido)}` : "$0.00";
    cambioText.className = `fs-3 fw-bold ${recibido > 0 ? "text-danger" : "text-primary"}`;
  }
}

pagoInput.addEventListener("input", calcularCambio);
document.querySelectorAll(".quick-cash").forEach(btn => {
  btn.addEventListener("click", () => { pagoInput.value = btn.dataset.val; calcularCambio(); });
});

btnCobrar.addEventListener("click", async () => {
  const total = totalCarrito();
  const pago = pagoInput.value === "" ? total : parseFloat(pagoInput.value) || 0;
  if (pago < total) {
    alert(`El efectivo recibido no alcanza. Faltan ${dinero(total - pago)}.`);
    return;
  }
  const cambio = pago - total;

  btnCobrar.disabled = true;
  btnCobrar.innerHTML = "Guardando...";

  try {
    const { data: venta, error: errVenta } = await db.from("ventas").insert({
      total, monto_recibido: pago, cambio, metodo_pago: "efectivo"
    }).select().single();
    if (errVenta) throw errVenta;

    const { error: errDet } = await db.from("detalle_ventas").insert(carrito.map(item => ({
      venta_id: venta.id,
      codigo_barras: item.codigo,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precio,
      costo_unitario: item.costo,
      subtotal: item.precio * item.cantidad
    })));
    if (errDet) throw errDet;

    for (const item of carrito) {
      await db.rpc("descontar_stock", { p_codigo: item.codigo, p_cantidad: item.cantidad });
    }

    alert(`¡Venta cerrada! Cambio a entregar: ${dinero(cambio)}`);
    ultimaVenta = { id: venta.id, total };
    mostrarDeshacer();
    carrito = [];
  } catch (err) {
    alert("Error al registrar venta: " + err.message);
  } finally {
    btnCobrar.innerHTML = `<i class="bi bi-check-circle-fill"></i> Completar Venta`;
    actualizarVistaCarrito();
    resetFocus();
  }
});

actualizarVistaCarrito();

// ---------- Cámara en la Caja ----------
// Se queda prendida para escanear varios productos seguidos.
let camaraCaja = null;
let ultimoCodigoCam = "";
let ultimoTiempoCam = 0;

function apagarCamaraCaja() {
  if (camaraCaja) camaraCaja.stop().catch(() => {});
  camaraCaja = null;
  $("readerCaja").style.display = "none";
  $("btnCamaraCaja").innerHTML = `<i class="bi bi-camera-fill me-1"></i> Cámara`;
}

$("btnCamaraCaja").addEventListener("click", () => {
  if (camaraCaja) { apagarCamaraCaja(); return; }
  $("readerCaja").style.display = "block";
  $("btnCamaraCaja").innerHTML = `<i class="bi bi-x-lg me-1"></i> Cerrar`;
  camaraCaja = new Html5Qrcode("readerCaja");
  camaraCaja.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 260, height: 140 } },
    (codigo) => {
      // Evita que el mismo producto se agregue 10 veces mientras sigue frente a la cámara
      const ahora = Date.now();
      if (codigo === ultimoCodigoCam && ahora - ultimoTiempoCam < 2000) return;
      ultimoCodigoCam = codigo;
      ultimoTiempoCam = ahora;
      if (navigator.vibrate) navigator.vibrate(80);
      agregarProductoPorCodigo(codigo);
    },
    () => {}
  ).catch(err => {
    alert("No se pudo abrir la cámara: " + err);
    apagarCamaraCaja();
  });
});

// ==============================================
// 2. RECEPCIÓN DE PEDIDOS (TICKET CON IA)
// ==============================================
const aiStatus = $("aiStatus");
const ticketResultBody = $("ticketResultBody");
const btnAplicarTodo = $("btnAplicarTodo");
let ticketItems = [];   // renglones leídos del ticket
let catalogoCache = []; // catálogo para cruzar códigos

$("btnTomarFotoTicket").addEventListener("click", () => $("ticketFileInput").click());

$("ticketFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // permite volver a escoger la misma foto
  if (!file) return;

  aiStatus.innerHTML = `
    <div class="alert alert-info py-2 d-flex align-items-center gap-2 mb-0">
      <div class="spinner-border spinner-border-sm"></div> Leyendo ticket con IA... (10–30 seg)
    </div>`;
  $("ticketResumen").textContent = "";

  try {
    const imagen = await comprimirYConvertirBase64(file, 1600, 0.8);
    const resp = await llamarIA("ticket", { imagen });
    const items = Array.isArray(resp.items) ? resp.items : [];
    if (items.length === 0) throw new Error("No se encontraron productos. Intenta con una foto más cercana y con buena luz.");

    const { data: catalogo, error } = await db.from("productos").select("*");
    if (error) throw error;
    catalogoCache = catalogo || [];

    ticketItems = items.map(it => armarRenglon({
      codigo: String(it.codigo_barras || "").replace(/\D/g, ""),
      nombreTicket: it.nombre_ticket || "",
      cantidad: parseFloat(it.cantidad) || 0,
      costo: parseFloat(it.costo_unitario) || 0
    }));

    alerta(aiStatus, "success", `Se leyeron <b>${ticketItems.length}</b> productos. Revisa y corrige si algo no cuadra.`);
    renderTicket();
  } catch (err) {
    alerta(aiStatus, "danger", `<b>No se pudo leer el ticket:</b> ${esc(err.message)}`);
  }
});

function armarRenglon(r) {
  const prodLocal = r.codigo ? catalogoCache.find(p => p.codigo_barras === r.codigo) : null;
  return {
    ...r,
    prodLocal,
    nombre: prodLocal ? prodLocal.nombre : r.nombreTicket,
    precio: precioSugerido(r.costo, prodLocal),
    aplicado: false
  };
}

function renderTicket() {
  ticketResultBody.innerHTML = ticketItems.map((r, i) => {
    const p = r.prodLocal;
    const costoAnt = p ? parseFloat(p.costo_compra) || 0 : 0;
    const dif = r.costo - costoAnt;
    let estado = '<span class="badge bg-secondary">Nuevo</span>';
    if (p) estado = dif > 0.009 ? `<span class="badge bg-danger">Subió +${dinero(dif)}</span>`
      : dif < -0.009 ? `<span class="badge bg-info text-dark">Bajó -${dinero(-dif)}</span>`
      : '<span class="badge bg-light text-secondary border">Igual</span>';
    const subio = p && dif > 0.009 && r.precio > (parseFloat(p.precio_venta) || 0);

    return `
    <tr class="${r.aplicado ? "fila-aplicada" : ""}">
      <td>
        ${p ? `<strong>${esc(r.nombre)}</strong>
               <div class="small text-muted">Ticket: ${esc(r.nombreTicket)}</div>`
            : `<input class="form-control form-control-sm fw-bold mb-1" data-i="${i}" data-campo="nombre" value="${esc(r.nombre)}" placeholder="Nombre para el catálogo">`}
        <div class="d-flex gap-1 align-items-center">
          <input class="form-control form-control-sm font-monospace" style="max-width: 160px;" data-i="${i}" data-campo="codigo" value="${esc(r.codigo)}" placeholder="Código de barras">
          ${p ? '<span class="badge bg-success"><i class="bi bi-check2"></i> En catálogo</span>' : '<span class="badge bg-warning text-dark">No registrado</span>'}
        </div>
      </td>
      <td class="text-center"><input type="number" class="form-control form-control-sm text-center fw-bold" style="width: 75px; margin: auto;" data-i="${i}" data-campo="cantidad" value="${r.cantidad}"></td>
      <td class="text-end"><input type="number" step="0.01" class="form-control form-control-sm text-end fw-bold" style="width: 90px; margin-left: auto;" data-i="${i}" data-campo="costo" value="${r.costo}"></td>
      <td class="text-end text-muted">${p ? dinero(costoAnt) : "—"}</td>
      <td class="text-center">${estado}</td>
      <td class="text-end">
        <input type="number" step="0.5" class="form-control form-control-sm text-end fw-bold ${subio ? "precio-subio" : ""}" style="width: 90px; margin-left: auto;" data-i="${i}" data-campo="precio" value="${r.precio}">
        ${p ? `<div class="small text-muted">antes ${dinero(p.precio_venta)}</div>` : ""}
      </td>
      <td class="text-center">
        ${r.aplicado ? '<span class="text-success fw-bold"><i class="bi bi-check-circle-fill"></i> Listo</span>'
          : `<button class="btn btn-sm ${p ? "btn-primary" : "btn-warning"} fw-bold" onclick="aplicarRenglonTicket(${i})">
               ${p ? '<i class="bi bi-arrow-up-circle me-1"></i>Surtir' : '<i class="bi bi-plus-circle me-1"></i>Alta y surtir'}
             </button>`}
      </td>
    </tr>`;
  }).join("");

  const totalTicket = ticketItems.reduce((a, r) => a + r.cantidad * r.costo, 0);
  const pendientes = ticketItems.filter(r => !r.aplicado).length;
  $("ticketResumen").innerHTML = `Total calculado: <b>${dinero(totalTicket)}</b> — compáralo con el total impreso en el ticket para confirmar que la IA leyó bien. · Pendientes: <b>${pendientes}</b>`;
  btnAplicarTodo.disabled = pendientes === 0;
}

// Edición en línea de la tabla del ticket
ticketResultBody.addEventListener("change", (e) => {
  const { i, campo } = e.target.dataset;
  if (i === undefined) return;
  const r = ticketItems[+i];
  if (campo === "nombre") { r.nombre = e.target.value; return; }
  if (campo === "precio") { r.precio = parseFloat(e.target.value) || 0; return; }
  if (campo === "cantidad") r.cantidad = parseFloat(e.target.value) || 0;
  if (campo === "costo") r.costo = parseFloat(e.target.value) || 0;
  if (campo === "codigo") r.codigo = e.target.value.replace(/\D/g, "");
  // Si cambió código o costo, se vuelve a cruzar con el catálogo y recalcular precio
  const nuevo = armarRenglon({ codigo: r.codigo, nombreTicket: r.nombreTicket, cantidad: r.cantidad, costo: r.costo });
  if (!nuevo.prodLocal) nuevo.nombre = r.nombre || r.nombreTicket; // conserva el nombre que ya escribió
  ticketItems[+i] = nuevo;
  renderTicket();
});

window.aplicarRenglonTicket = async function (i, silencioso = false) {
  const r = ticketItems[i];
  if (r.aplicado) return true;
  if (!r.codigo) { if (!silencioso) alert("Falta el código de barras de este producto."); return false; }
  if (r.cantidad <= 0 || r.precio <= 0) { if (!silencioso) alert("Revisa cantidad y precio."); return false; }

  try {
    if (r.prodLocal) {
      // Suma stock, actualiza costo y precio en un solo paso (función SQL)
      const { error } = await db.rpc("surtir_producto", {
        p_codigo: r.codigo, p_cantidad: r.cantidad, p_costo: r.costo, p_precio: r.precio
      });
      if (error) throw error;
    } else {
      if (!r.nombre.trim()) throw new Error("Escribe el nombre del producto nuevo.");
      const { error } = await db.from("productos").insert({
        codigo_barras: r.codigo, nombre: r.nombre.trim(), costo_compra: r.costo,
        precio_venta: r.precio, stock_actual: r.cantidad, foto_url: "",
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      await db.from("recepciones").insert({ codigo_barras: r.codigo, cantidad: r.cantidad, costo_unitario: r.costo });
    }
    r.aplicado = true;
    renderTicket();
    return true;
  } catch (err) {
    if (!silencioso) alert(`Error con ${r.nombre || r.codigo}: ${err.message}`);
    return false;
  }
};

btnAplicarTodo.addEventListener("click", async () => {
  btnAplicarTodo.disabled = true;
  let ok = 0, fallos = [];
  for (let i = 0; i < ticketItems.length; i++) {
    if (ticketItems[i].aplicado) continue;
    if (await aplicarRenglonTicket(i, true)) ok++;
    else fallos.push(ticketItems[i].nombre || ticketItems[i].nombreTicket);
  }
  if (fallos.length) alerta(aiStatus, "warning", `Se aplicaron ${ok}. Revisa estos (falta código, nombre o precio): <b>${fallos.map(esc).join(", ")}</b>`);
  else alerta(aiStatus, "success", `¡Listo! Se actualizaron ${ok} productos: stock, costo y precio.`);
  renderTicket();
});

// Redimensiona y comprime la foto en el dispositivo antes de enviarla
function comprimirYConvertirBase64(file, maxDimension = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const escala = Math.min(1, maxDimension / Math.max(width, height));
        width = Math.round(width * escala);
        height = Math.round(height * escala);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = () => reject(new Error("No se pudo abrir la imagen (¿formato HEIC?). Prueba tomando la foto desde la app."));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

// ==============================================
// 3. CATÁLOGO Y ALTA RÁPIDA
// ==============================================
const codigoInput = $("codigoInput");
const nombreInput = $("nombreInput");
const costoInput = $("costoInput");
const precioInput = $("precioInput");
const stockInput = $("stockInput");
const stockMinInput = $("stockMinInput");
const proveedorSelect = $("proveedorSelect");
const previewFoto = $("previewFoto");
const statusMsgCat = $("statusMsgCat");
const btnGuardarProd = $("btnGuardarProd");

let currentFotoUrl = "";
let html5QrCode = null;
previewFoto.src = FOTO_VACIA;

async function cargarProveedores() {
  const { data } = await db.from("proveedores").select("id, nombre").order("nombre");
  proveedorSelect.innerHTML = '<option value="">-- General --</option>' +
    (data || []).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
}

function mostrarMargen() {
  const c = parseFloat(costoInput.value), p = parseFloat(precioInput.value);
  $("margenInfo").textContent = c > 0 && p > 0 ? `Ganancia: ${dinero(p - c)} por pieza (${Math.round((p / c - 1) * 100)}%)` : "";
}
costoInput.addEventListener("input", mostrarMargen);
precioInput.addEventListener("input", mostrarMargen);

codigoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const codigo = codigoInput.value.trim();
    if (codigo) procesarCodigoCatalogo(codigo);
  }
});

async function procesarCodigoCatalogo(codigo) {
  statusMsgCat.innerHTML = `<span class="text-primary"><i class="bi bi-hourglass-split"></i> Buscando producto...</span>`;
  const { data: localProd } = await db.from("productos").select("*").eq("codigo_barras", codigo).maybeSingle();

  if (localProd) {
    nombreInput.value = localProd.nombre;
    costoInput.value = localProd.costo_compra;
    precioInput.value = localProd.precio_venta;
    stockInput.value = localProd.stock_actual;
    stockMinInput.value = localProd.stock_minimo ?? 5;
    proveedorSelect.value = localProd.proveedor_id || "";
    currentFotoUrl = localProd.foto_url || "";
    previewFoto.src = currentFotoUrl || FOTO_VACIA;
    mostrarMargen();
    statusMsgCat.innerHTML = `<span class="text-success fw-bold"><i class="bi bi-check-circle"></i> Ya está en tu catálogo. Modifica lo que necesites.</span>`;
    return;
  }

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=product_name,product_name_es,image_front_small_url`);
    const json = await res.json();
    if (json.status === 1 && json.product) {
      nombreInput.value = json.product.product_name_es || json.product.product_name || "";
      currentFotoUrl = json.product.image_front_small_url || "";
      previewFoto.src = currentFotoUrl || FOTO_VACIA;
      costoInput.value = "";
      precioInput.value = "";
      costoInput.focus();
      statusMsgCat.innerHTML = `<span class="text-info fw-bold"><i class="bi bi-cloud-arrow-down"></i> Autocompletado desde Open Food Facts. Asigna costo y precio.</span>`;
    } else {
      limpiarFormularioCat(false);
      nombreInput.focus();
      statusMsgCat.innerHTML = `<span class="text-warning fw-bold"><i class="bi bi-pencil"></i> Código nuevo. Escribe los datos manualmente.</span>`;
    }
  } catch (err) {
    statusMsgCat.innerHTML = `<span class="text-secondary">Sin red externa. Captura manual activa.</span>`;
  }
}

btnGuardarProd.addEventListener("click", async () => {
  const codigo = codigoInput.value.trim();
  const nombre = nombreInput.value.trim();
  const precio = parseFloat(precioInput.value) || 0;

  if (!codigo || !nombre || precio <= 0) {
    alert("Ingresa código, nombre y un precio de venta mayor a $0.");
    return;
  }

  btnGuardarProd.disabled = true;
  btnGuardarProd.textContent = "Guardando...";

  const { error } = await db.from("productos").upsert({
    codigo_barras: codigo,
    nombre,
    costo_compra: parseFloat(costoInput.value) || 0,
    precio_venta: precio,
    stock_actual: parseFloat(stockInput.value) || 0,
    stock_minimo: parseFloat(stockMinInput.value) || 0,
    proveedor_id: proveedorSelect.value ? parseInt(proveedorSelect.value) : null,
    foto_url: currentFotoUrl,
    updated_at: new Date().toISOString()
  });

  btnGuardarProd.disabled = false;
  btnGuardarProd.innerHTML = `<i class="bi bi-save2-fill"></i> Guardar en Catálogo`;

  if (error) {
    alert("Error al guardar: " + error.message);
  } else {
    statusMsgCat.innerHTML = `<span class="text-success fw-bold"><i class="bi bi-check2-all"></i> ¡Guardado! Listo para el siguiente.</span>`;
    limpiarFormularioCat(true);
    codigoInput.focus();
    cargarListaCatalogo();
  }
});

$("btnNuevoProd").addEventListener("click", () => {
  limpiarFormularioCat(true);
  statusMsgCat.innerHTML = `<span class="text-muted">Formulario limpio. Escanea o escribe un código nuevo.</span>`;
  codigoInput.focus();
});

// ---------- Lista de productos del catálogo ----------
let productosLista = [];
const tablaProductos = $("tablaProductos");

async function cargarListaCatalogo() {
  const { data, error } = await db.from("productos").select("*").order("nombre");
  if (error) {
    tablaProductos.innerHTML = `<tr><td colspan="6" class="text-danger">${esc(error.message)}</td></tr>`;
    return;
  }
  productosLista = (data || []).filter(p => !p.es_rapido); // los botones sin código se editan desde Caja
  renderListaCatalogo();
}

function renderListaCatalogo() {
  const q = $("buscarProducto").value.trim().toLowerCase();
  const filtro = $("filtroProductos").value;

  let lista = productosLista.filter(p =>
    !q || (p.nombre || "").toLowerCase().includes(q) || (p.codigo_barras || "").includes(q));

  if (filtro === "bajo") lista = lista.filter(p => (+p.stock_actual || 0) <= (+(p.stock_minimo ?? 5)));
  if (filtro === "sinmargen") lista = lista.filter(p => {
    const c = +p.costo_compra || 0, pr = +p.precio_venta || 0;
    return c > 0 && (pr / c - 1) < 0.15;
  });

  $("contadorProductos").textContent = lista.length === productosLista.length
    ? productosLista.length : `${lista.length} de ${productosLista.length}`;

  if (lista.length === 0) {
    tablaProductos.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">${productosLista.length ? "Nada coincide con la búsqueda." : "Aún no hay productos."}</td></tr>`;
    return;
  }

  tablaProductos.innerHTML = lista.slice(0, 400).map(p => {
    const costo = +p.costo_compra || 0, precio = +p.precio_venta || 0;
    const stock = +p.stock_actual || 0, minimo = +(p.stock_minimo ?? 5);
    const margen = costo > 0 ? Math.round((precio / costo - 1) * 100) : null;
    const colorMargen = margen === null ? "secondary" : margen < 15 ? "danger" : margen < 25 ? "warning" : "success";
    const cod = esc(p.codigo_barras);
    return `
      <tr>
        <td>
          <div class="fw-semibold">${esc(p.nombre)}</div>
          <div class="small text-muted font-monospace">${cod}</div>
        </td>
        <td class="text-end text-muted">${dinero(costo)}</td>
        <td class="text-end">
          <input type="number" step="0.5" class="form-control form-control-sm text-end fw-bold edit-rapido" style="width: 80px; margin-left: auto;" data-codigo="${cod}" data-campo="precio_venta" value="${precio}">
        </td>
        <td class="text-center"><span class="badge text-bg-${colorMargen}">${margen === null ? "—" : margen + "%"}</span></td>
        <td class="text-center">
          <input type="number" class="form-control form-control-sm text-center edit-rapido ${stock <= minimo ? "border-danger text-danger fw-bold" : ""}" style="width: 65px; margin: auto;" data-codigo="${cod}" data-campo="stock_actual" value="${stock}" title="Mínimo: ${minimo}">
        </td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm btn-outline-primary" onclick="editarProducto('${cod}')" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="borrarProducto('${cod}')" title="Eliminar"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  }).join("") + (lista.length > 400 ? `<tr><td colspan="6" class="text-center small text-muted">Mostrando 400 de ${lista.length}. Usa el buscador.</td></tr>` : "");
}

$("buscarProducto").addEventListener("input", renderListaCatalogo);
$("filtroProductos").addEventListener("change", renderListaCatalogo);

// Edición rápida de precio y stock directo en la tabla
tablaProductos.addEventListener("change", async (e) => {
  const el = e.target;
  if (!el.classList.contains("edit-rapido")) return;
  const valor = parseFloat(el.value);
  if (isNaN(valor) || valor < 0 || (el.dataset.campo === "precio_venta" && valor === 0)) {
    alert("Valor no válido.");
    renderListaCatalogo();
    return;
  }
  el.disabled = true;
  const { error } = await db.from("productos")
    .update({ [el.dataset.campo]: valor, updated_at: new Date().toISOString() })
    .eq("codigo_barras", el.dataset.codigo);
  el.disabled = false;
  if (error) { alert("No se guardó: " + error.message); renderListaCatalogo(); return; }

  const p = productosLista.find(x => x.codigo_barras === el.dataset.codigo);
  if (p) p[el.dataset.campo] = valor;
  el.classList.add("is-valid");
  setTimeout(() => renderListaCatalogo(), 700);
});

window.editarProducto = function (codigo) {
  codigoInput.value = codigo;
  procesarCodigoCatalogo(codigo);
  $("formCatalogo").scrollIntoView({ behavior: "smooth", block: "start" });
};

window.borrarProducto = async function (codigo) {
  const p = productosLista.find(x => x.codigo_barras === codigo);
  if (!confirm(`¿Eliminar "${p?.nombre || codigo}" del catálogo?\nEsto no se puede deshacer.`)) return;
  const { error } = await db.from("productos").delete().eq("codigo_barras", codigo);
  if (error) {
    alert("No se pudo eliminar (puede que tenga ventas registradas). Mejor ponle stock 0.\n\n" + error.message);
    return;
  }
  cargarListaCatalogo();
};

function limpiarFormularioCat(limpiarCodigo = true) {
  if (limpiarCodigo) codigoInput.value = "";
  nombreInput.value = "";
  costoInput.value = "";
  precioInput.value = "";
  stockInput.value = "10";
  stockMinInput.value = "5";
  proveedorSelect.value = "";
  currentFotoUrl = "";
  previewFoto.src = FOTO_VACIA;
  $("margenInfo").textContent = "";
}

$("btnCamara").addEventListener("click", () => {
  const readerDiv = $("reader");
  if (readerDiv.style.display === "block") {
    if (html5QrCode) html5QrCode.stop().catch(() => {});
    readerDiv.style.display = "none";
    return;
  }
  readerDiv.style.display = "block";
  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (decodedText) => {
      codigoInput.value = decodedText;
      html5QrCode.stop().catch(() => {});
      readerDiv.style.display = "none";
      procesarCodigoCatalogo(decodedText);
    },
    () => {}
  ).catch(err => {
    alert("Error de cámara: " + err);
    readerDiv.style.display = "none";
  });
});

// ==============================================
// 4. LISTA DE FALTANTES
// ==============================================
let faltantesTexto = "";

$("btnGenerarFaltantes").addEventListener("click", async () => {
  const dias = parseInt($("diasFaltantes").value);
  const status = $("faltantesStatus");
  status.innerHTML = `<span class="text-primary">Calculando...</span>`;

  const { data, error } = await db.rpc("lista_faltantes", { p_dias: dias });
  if (error) { status.innerHTML = `<span class="text-danger">Error: ${esc(error.message)}</span>`; return; }

  const ticket = $("ticketFaltantes");
  const fecha = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  if (!data || data.length === 0) {
    ticket.innerHTML = `<div class="text-center py-4 vacio"><svg class="abeja-xl"><use href="#abeja"/></svg><div>No falta nada. ¡Todo surtido!</div></div>`;
    faltantesTexto = "";
    $("btnImprimirFaltantes").disabled = $("btnCopiarFaltantes").disabled = true;
    status.textContent = "";
    return;
  }

  // Agrupar por proveedor
  const grupos = {};
  data.forEach(f => (grupos[f.proveedor] ||= []).push(f));

  let html = `<div class="text-center fw-bold fs-5">BARRYSTORE</div>
    <div class="text-center small">Lista de pedido · ${fecha}</div>
    <div class="text-center small mb-2">Basado en ventas de ${dias} días</div>`;
  faltantesTexto = `*Pedido BarryStore* (${fecha})\n`;

  for (const [prov, items] of Object.entries(grupos)) {
    html += `<h6 class="fw-bold">${esc(prov)}</h6><table class="w-100 small">`;
    faltantesTexto += `\n*${prov}*\n`;
    items.forEach(f => {
      html += `<tr><td>☐ ${esc(f.nombre)}<div class="text-muted" style="font-size:.75rem">hay ${f.stock_actual} · vendió ${f.vendidos}</div></td>
               <td class="text-end fw-bold align-top">${f.pedir} pz</td></tr>`;
      faltantesTexto += `- ${f.nombre}: ${f.pedir} pz\n`;
    });
    html += `</table>`;
  }
  html += `<div class="text-center small mt-3 border-top pt-2">${data.length} productos por pedir</div>`;
  ticket.innerHTML = html;
  $("btnImprimirFaltantes").disabled = $("btnCopiarFaltantes").disabled = false;
  status.textContent = "";
});

$("btnImprimirFaltantes").addEventListener("click", () => window.print());
$("btnCopiarFaltantes").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(faltantesTexto);
    $("faltantesStatus").innerHTML = `<span class="text-success fw-bold">Copiado. Pégalo en WhatsApp.</span>`;
  } catch (_) {
    prompt("Copia este texto:", faltantesTexto);
  }
});

// ==============================================
// 5. COMPARADOR DE PRECIOS
// ==============================================
let productoPrecio = null;
const precioBuscarInput = $("precioBuscarInput");

async function cargarListaProductos() {
  const { data } = await db.from("productos").select("codigo_barras, nombre, precio_venta, costo_compra").order("nombre");
  catalogoCache = data || catalogoCache;
  $("listaProductos").innerHTML = (data || []).map(p => `<option value="${esc(p.nombre)}">${esc(p.codigo_barras)}</option>`).join("");
}

precioBuscarInput.addEventListener("change", () => {
  const v = precioBuscarInput.value.trim();
  productoPrecio = catalogoCache.find(p => p.codigo_barras === v || p.nombre === v) || null;
  const info = $("precioProductoInfo");
  if (productoPrecio) {
    info.innerHTML = `Tu precio: <b class="text-success">${dinero(productoPrecio.precio_venta)}</b> · costo ${dinero(productoPrecio.costo_compra)}`;
    precioBuscarInput.value = productoPrecio.nombre;
  } else {
    info.innerHTML = v ? `<span class="text-danger">No está en el catálogo.</span>` : "";
  }
  $("btnBuscarPreciosIA").disabled = $("btnGuardarManual").disabled = !productoPrecio;
});
precioBuscarInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); precioBuscarInput.dispatchEvent(new Event("change")); }
});

$("btnBuscarPreciosIA").addEventListener("click", async () => {
  if (!productoPrecio) return;
  const status = $("preciosStatus");
  const btn = $("btnBuscarPreciosIA");
  btn.disabled = true;
  status.innerHTML = `<div class="alert alert-info py-2 d-flex gap-2 align-items-center mb-0"><div class="spinner-border spinner-border-sm"></div> Buscando en internet...</div>`;

  try {
    const resp = await llamarIA("precios", { producto: productoPrecio.nombre, ciudad: CIUDAD });
    const encontrados = (resp.items || []).filter(x => parseFloat(x.precio) > 0);
    if (encontrados.length === 0) throw new Error("No se encontraron precios publicados para este producto.");

    const { error } = await db.from("precios_competencia").insert(encontrados.map(x => ({
      codigo_barras: productoPrecio.codigo_barras,
      tienda: x.tienda,
      precio: parseFloat(x.precio),
      presentacion: x.presentacion || null,
      fuente: x.fuente || null,
      origen: "ia"
    })));
    if (error) throw error;

    const fuentes = (resp.fuentes || []).slice(0, 4)
      .map(f => `<a href="${esc(f.uri)}" target="_blank" rel="noopener">${esc(f.title || "fuente")}</a>`).join(" · ");
    alerta(status, "success", `Se encontraron ${encontrados.length} precios.
      <div class="small mt-1">Son precios publicados en internet: tómalos como referencia, pueden variar por sucursal.</div>
      ${fuentes ? `<div class="small mt-1">Fuentes: ${fuentes}</div>` : ""}`);
    cargarFeedPrecios();
  } catch (err) {
    alerta(status, "danger", esc(err.message));
  } finally {
    btn.disabled = false;
  }
});

$("btnGuardarManual").addEventListener("click", async () => {
  const precio = parseFloat($("precioManual").value);
  if (!productoPrecio || !(precio > 0)) { alert("Escribe el precio."); return; }
  const { error } = await db.from("precios_competencia").insert({
    codigo_barras: productoPrecio.codigo_barras, tienda: $("tiendaManual").value, precio, origen: "manual"
  });
  if (error) { alert("Error: " + error.message); return; }
  $("precioManual").value = "";
  alerta($("preciosStatus"), "success", "Precio guardado.");
  cargarFeedPrecios();
});

$("btnRefrescarFeed").addEventListener("click", cargarFeedPrecios);

async function cargarFeedPrecios() {
  const feed = $("feedPrecios");
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: precios, error }, { data: prods }] = await Promise.all([
    db.from("precios_competencia").select("*").gte("created_at", hace30).order("created_at", { ascending: false }),
    db.from("productos").select("codigo_barras, nombre, precio_venta")
  ]);
  if (error) { feed.innerHTML = `<div class="alert alert-danger">${esc(error.message)}</div>`; return; }
  if (!precios || precios.length === 0) {
    feed.innerHTML = `<div class="card p-4 text-center vacio"><svg class="abeja-xl mx-auto"><use href="#abeja"/></svg><div>Aún no hay precios. Busca un producto a la izquierda.</div></div>`;
    return;
  }

  // Último precio por tienda, agrupado por producto
  const porProducto = {};
  precios.forEach(p => {
    const g = (porProducto[p.codigo_barras] ||= {});
    if (!g[p.tienda]) g[p.tienda] = p; // ya viene ordenado del más reciente
  });

  const tarjetas = Object.entries(porProducto).map(([codigo, tiendas]) => {
    const prod = (prods || []).find(p => p.codigo_barras === codigo);
    if (!prod) return null;
    const mio = parseFloat(prod.precio_venta);
    const lista = Object.values(tiendas);
    const valores = lista.map(t => parseFloat(t.precio));
    const prom = valores.reduce((a, b) => a + b, 0) / valores.length;
    const oxxo = lista.find(t => /oxxo|7-?eleven/i.test(t.tienda));

    let veredicto;
    if (mio > Math.max(...valores)) veredicto = { cls: "danger", txt: "Más caro que todos" };
    else if (oxxo && mio > parseFloat(oxxo.precio)) veredicto = { cls: "warning", txt: `Arriba de ${oxxo.tienda}` };
    else if (mio < Math.min(...valores)) veredicto = { cls: "info", txt: "El más barato (¿le subes?)" };
    else veredicto = { cls: "success", txt: "Buen precio" };

    const chips = lista.sort((a, b) => a.precio - b.precio).map(t => `
      <span class="badge rounded-pill text-bg-light border tienda-chip me-1 mb-1" title="${t.origen === "ia" ? "Encontrado en internet" : "Anotado a mano"}">
        ${esc(t.tienda)} <b>${dinero(t.precio)}</b>${t.origen === "ia" ? ' <i class="bi bi-stars"></i>' : ""}
      </span>`).join("");

    return { veredicto, html: `
      <div class="card border-0 shadow-sm mb-2 feed-card">
        <div class="card-body py-2">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <div class="fw-bold">${esc(prod.nombre)}</div>
              <div class="small text-muted">Tú: <b class="text-dark">${dinero(mio)}</b> · Promedio: ${dinero(prom)}</div>
            </div>
            <span class="badge text-bg-${veredicto.cls}">${veredicto.txt}</span>
          </div>
          <div class="mt-2">${chips}</div>
        </div>
      </div>` };
  }).filter(Boolean);

  // Primero los que están caros
  const orden = { danger: 0, warning: 1, info: 2, success: 3 };
  tarjetas.sort((a, b) => orden[a.veredicto.cls] - orden[b.veredicto.cls]);
  feed.innerHTML = tarjetas.map(t => t.html).join("") || `<div class="text-muted">Sin datos.</div>`;
}

// ==============================================
// 6. ENTRADA CON CORREO Y CONTRASEÑA
// ==============================================
// La sesión se guarda en la tablet: tu mamá entra una vez y ya no le vuelve a pedir.
const pantallaLogin = $("pantallaLogin");
const appEl = $("app");
let appIniciada = false;

function mostrarSegunSesion(session) {
  if (session) {
    pantallaLogin.style.display = "none";
    appEl.style.display = "block";
    if (!appIniciada) {
      appIniciada = true;
      cargarProveedores();
      cargarRapidos();
      abrirTab("seccionVentas");
    }
  } else {
    appIniciada = false;
    appEl.style.display = "none";
    pantallaLogin.style.display = "flex";
    $("loginCorreo").focus();
  }
}

// setTimeout: Supabase recomienda no hacer consultas dentro de este aviso directamente
db.auth.onAuthStateChange((_evento, session) => {
  setTimeout(() => mostrarSegunSesion(session), 0);
});

$("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btnLogin");
  $("loginError").textContent = "";
  btn.disabled = true;
  btn.textContent = "Entrando...";
  const { error } = await db.auth.signInWithPassword({
    email: $("loginCorreo").value.trim(),
    password: $("loginPass").value
  });
  btn.disabled = false;
  btn.textContent = "Entrar";
  if (error) {
    $("loginError").textContent = /invalid/i.test(error.message)
      ? "Correo o contraseña incorrectos."
      : "No se pudo entrar: " + error.message;
    return;
  }
  $("loginPass").value = "";
});

$("btnSalir").addEventListener("click", async () => {
  if (!confirm("¿Cerrar sesión en este dispositivo?")) return;
  carrito = [];
  actualizarVistaCarrito();
  await db.auth.signOut();
});

// ==============================================
// 7. VENTAS Y UTILIDADES
// ==============================================
const ZONA = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
let periodoActual = "hoy";

function inicioDia(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function sumarDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function aISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// Devuelve el rango del periodo y el rango con el que se compara
function rangoPeriodo(p) {
  const hoy = inicioDia(new Date());
  const lunes = sumarDias(hoy, -((hoy.getDay() + 6) % 7)); // semana de lunes a domingo
  let r;
  switch (p) {
    case "ayer":         r = { desde: sumarDias(hoy, -1), hasta: hoy, agrupar: "hora", vs: "antier" }; break;
    case "semana":       r = { desde: lunes, hasta: sumarDias(lunes, 7), agrupar: "dia", vs: "la semana pasada" }; break;
    case "semanaPasada": r = { desde: sumarDias(lunes, -7), hasta: lunes, agrupar: "dia", vs: "la semana anterior" }; break;
    case "mes":          r = { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1), hasta: new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1), agrupar: "dia", vs: "el mes pasado", esMes: true }; break;
    case "rango": {
      const d = $("fechaDesde").value, h = $("fechaHasta").value || d;
      if (!d) return null;
      const [y1, m1, d1] = d.split("-").map(Number), [y2, m2, d2] = h.split("-").map(Number);
      const desde = new Date(y1, m1 - 1, d1), hasta = sumarDias(new Date(y2, m2 - 1, d2), 1);
      if (hasta <= desde) return null;
      r = { desde, hasta, agrupar: (hasta - desde) <= 864e5 ? "hora" : "dia", vs: "el periodo anterior" };
      break;
    }
    default:             r = { desde: hoy, hasta: sumarDias(hoy, 1), agrupar: "hora", vs: "ayer a esta hora" };
  }
  // Periodo anterior: mismo lapso transcurrido (si hoy van 5 horas, compara contra las primeras 5 de ayer)
  const transcurrido = Math.min(Date.now(), r.hasta) - r.desde;
  const prevDesde = r.esMes ? new Date(r.desde.getFullYear(), r.desde.getMonth() - 1, 1) : new Date(r.desde - (r.hasta - r.desde));
  r.prev = { desde: prevDesde, hasta: new Date(+prevDesde + Math.max(transcurrido, 0)) };
  return r;
}

async function pedirReporte(desde, hasta, agrupar) {
  const { data, error } = await db.rpc("reporte_ventas", {
    p_desde: desde.toISOString(), p_hasta: hasta.toISOString(), p_agrupar: agrupar, p_tz: ZONA
  });
  if (error) throw error;
  return data;
}

function deltaHTML(actual, anterior, texto) {
  if (!(anterior > 0)) return actual > 0 ? `<span class="text-secondary">sin datos de ${texto}</span>` : "";
  const pct = Math.round((actual / anterior - 1) * 100);
  const cls = pct >= 0 ? "delta-sube" : "delta-baja";
  return `<span class="${cls}">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span> vs ${texto}`;
}

document.querySelectorAll(".periodo-btn").forEach(btn => btn.addEventListener("click", () => {
  periodoActual = btn.dataset.p;
  document.querySelectorAll(".periodo-btn").forEach(b =>
    b.className = `btn btn-sm ${b === btn ? "btn-primary" : "btn-outline-primary"} periodo-btn`);
  const rango = $("rangoFechas");
  if (periodoActual === "rango") {
    rango.classList.replace("d-none", "d-flex");
    if (!$("fechaDesde").value) { $("fechaDesde").value = aISO(sumarDias(new Date(), -6)); $("fechaHasta").value = aISO(new Date()); }
  } else {
    rango.classList.replace("d-flex", "d-none");
  }
  cargarReporte();
}));
$("btnAplicarRango").addEventListener("click", cargarReporte);
$("btnRefrescarReporte").addEventListener("click", cargarReporte);

async function cargarReporte() {
  const r = rangoPeriodo(periodoActual);
  if (!r) { $("avisoSinCosto").innerHTML = `<div class="alert alert-warning py-2 mb-0">Revisa las fechas.</div>`; return; }

  ["kpiVendido", "kpiUtilidad", "kpiTickets", "kpiPromedio"].forEach(id => $(id).innerHTML = `<span class="spinner-border spinner-border-sm"></span>`);
  try {
    const [act, ant] = await Promise.all([
      pedirReporte(r.desde, r.hasta, r.agrupar),
      pedirReporte(r.prev.desde, r.prev.hasta, r.agrupar)
    ]);
    pintarReporte(act, ant, r);
  } catch (err) {
    $("avisoSinCosto").innerHTML = `<div class="alert alert-danger py-2 mb-0">No se pudo cargar: ${esc(err.message)}. ¿Ya corriste <b>supabase_reportes.sql</b>?</div>`;
    ["kpiVendido", "kpiUtilidad", "kpiTickets", "kpiPromedio"].forEach(id => $(id).textContent = "—");
  }
}

function pintarReporte(a, b, r) {
  const vendido = +a.vendido || 0, utilidad = vendido - (+a.costo || 0);
  const vendidoAnt = +b.vendido || 0, utilidadAnt = vendidoAnt - (+b.costo || 0);
  const tickets = +a.tickets || 0;

  $("kpiVendido").textContent = dinero(vendido);
  $("kpiVendidoDelta").innerHTML = deltaHTML(vendido, vendidoAnt, r.vs);
  $("kpiUtilidad").textContent = dinero(utilidad);
  $("kpiUtilidadDelta").innerHTML = deltaHTML(utilidad, utilidadAnt, r.vs);
  $("kpiTickets").textContent = tickets;
  $("kpiPiezas").textContent = `${+a.piezas || 0} piezas vendidas` + (a.canceladas > 0 ? ` · ${a.canceladas} cancelada${a.canceladas > 1 ? "s" : ""}` : "");
  $("kpiPromedio").textContent = dinero(tickets ? vendido / tickets : 0);
  $("kpiMargen").textContent = vendido > 0 ? `Ganas ${Math.round(utilidad / vendido * 100)}¢ de cada $1` : "";

  $("avisoSinCosto").innerHTML = a.sin_costo > 0
    ? `<div class="alert alert-warning py-2 mb-0 small"><i class="bi bi-exclamation-triangle me-1"></i>${a.sin_costo} producto(s) vendidos no tienen costo registrado, así que la utilidad sale más alta de lo real. Ponles costo en Catálogo.</div>`
    : "";

  pintarGrafica(a.serie || [], r);
  pintarTop(a.top || []);
  pintarTickets(a.ultimas || [], r.agrupar === "dia");
}

function pintarGrafica(serie, r) {
  const mapa = Object.fromEntries(serie.map(s => [s.etiqueta, s]));
  let columnas = [];

  if (r.agrupar === "hora") {
    $("tituloGrafica").textContent = "Ventas por hora";
    const horas = serie.map(s => +s.etiqueta);
    const ini = Math.min(7, ...horas), fin = Math.max(21, ...horas);
    for (let h = ini; h <= fin; h++) {
      const k = String(h).padStart(2, "0");
      columnas.push({ etq: `${h % 12 || 12}${h < 12 ? "a" : "p"}`, d: mapa[k] });
    }
  } else {
    $("tituloGrafica").textContent = "Ventas por día";
    const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    const muchos = (r.hasta - r.desde) / 864e5 > 10;
    for (let d = new Date(r.desde); d < r.hasta; d = sumarDias(d, 1)) {
      columnas.push({ etq: muchos ? String(d.getDate()) : `${dias[d.getDay()]} ${d.getDate()}`, d: mapa[aISO(d)] });
    }
  }

  const max = Math.max(1, ...columnas.map(c => +(c.d?.vendido) || 0));
  const mostrarValores = columnas.length <= 16;
  $("grafica").innerHTML = columnas.map(c => {
    const v = +(c.d?.vendido) || 0, u = Math.max(0, +(c.d?.utilidad) || 0);
    const alto = v ? Math.max(3, v / max * 100) : 1.5;
    const pctU = v ? Math.min(100, u / v * 100) : 0;
    return `<div class="col-g" title="${c.etq}: vendido ${dinero(v)} · utilidad ${dinero(u)}">
      ${mostrarValores && v ? `<div class="val">$${Math.round(v)}</div>` : ""}
      <div class="barra ${v ? "" : "vacia"}" style="height:${alto}%"><div class="util" style="height:${pctU}%"></div></div>
      <div class="etq">${c.etq}</div>
    </div>`;
  }).join("");
}

function pintarTop(top) {
  $("tablaTop").innerHTML = top.length ? top.map((t, i) => `
    <tr>
      <td><span class="text-secondary me-1">${i + 1}.</span>${esc(t.nombre)}</td>
      <td class="text-center">${+t.piezas}</td>
      <td class="text-end">${dinero(t.vendido)}</td>
      <td class="text-end fw-bold">${dinero(t.utilidad)}</td>
    </tr>`).join("")
    : `<tr><td colspan="4" class="text-center vacio py-4"><svg class="abeja-xl"><use href="#abeja"/></svg><div>Sin ventas en este periodo.</div></td></tr>`;
}

function pintarTickets(lista, conFecha) {
  if (!lista.length) { $("listaTickets").innerHTML = `<div class="text-center text-secondary py-4">Sin tickets.</div>`; return; }
  const fmt = new Intl.DateTimeFormat("es-MX", conFecha
    ? { weekday: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { hour: "numeric", minute: "2-digit" });
  $("listaTickets").innerHTML = lista.map(t => {
    const items = t.items || [];
    const pzas = items.reduce((a, i) => a + (+i.cantidad || 0), 0);
    return `<details class="ticket-item ${t.cancelada ? "ticket-cancelado" : ""}">
      <summary>
        <span><i class="bi bi-clock me-1 text-secondary"></i>${fmt.format(new Date(t.created_at))}
          <span class="text-secondary small ms-1">· ${pzas} pza${pzas === 1 ? "" : "s"}</span>
          ${t.cancelada ? '<span class="badge text-bg-danger ms-1">Cancelada</span>' : ""}</span>
        <b>${dinero(t.total)}</b>
      </summary>
      <div class="detalle">
        ${items.map(i => `<div class="d-flex justify-content-between"><span>${+i.cantidad} × ${esc(i.nombre)}</span><span>${dinero(i.cantidad * i.precio)}</span></div>`).join("")}
        ${t.cancelada ? "" : `<div class="text-end mt-2">
          <button class="btn btn-sm btn-outline-danger" onclick="cancelarVenta('${esc(String(t.id))}', ${+t.total})">
            <i class="bi bi-x-circle me-1"></i>Cancelar venta
          </button></div>`}
      </div>
    </details>`;
  }).join("") + (lista.length >= 60 ? `<div class="small text-secondary text-center mt-1">Se muestran los últimos 60 tickets.</div>` : "");
}

// ==============================================
// 8. CARRITO: agregar (junta piezas iguales)
// ==============================================
function agregarItem({ codigo, nombre, precio, costo }) {
  const item = carrito.find(i => i.codigo === codigo && i.precio === precio);
  if (item) item.cantidad += 1;
  else carrito.push({ codigo, nombre, precio, costo: costo || 0, cantidad: 1 });
  actualizarVistaCarrito();
}

// ==============================================
// 9. CANCELAR VENTAS
// ==============================================
let ultimaVenta = null;

function mostrarDeshacer() {
  $("deshacerVenta").innerHTML = ultimaVenta
    ? `<button class="btn btn-link btn-sm text-danger p-0" onclick="cancelarVenta('${esc(String(ultimaVenta.id))}', ${ultimaVenta.total}, true)">
         <i class="bi bi-arrow-counterclockwise me-1"></i>¿Te equivocaste? Cancelar la última venta (${dinero(ultimaVenta.total)})</button>`
    : "";
}

window.cancelarVenta = async function (id, total, desdeCaja = false) {
  if (!confirm(`¿Cancelar esta venta de ${dinero(total)}?\n\nLos productos regresan al inventario y ya no cuenta en las ventas.`)) return;
  const { error } = await db.rpc("cancelar_venta", { p_venta: String(id) });
  if (error) { alert("No se pudo cancelar: " + error.message); return; }

  if (ultimaVenta && String(ultimaVenta.id) === String(id)) { ultimaVenta = null; mostrarDeshacer(); }
  if (desdeCaja) alert(`Venta cancelada. Si ya habías dado cambio, regresa ${dinero(total)} al cliente.`);
  if ($("seccionReporte").style.display === "block") cargarReporte();
};

// ==============================================
// 10. BOTONES SIN CÓDIGO (tortillas, huevo, sueltos...)
// ==============================================
// Se guardan como productos con es_rapido = true y un código inventado ("R-...").
const ICONOS = ["", "🫓", "🥚", "🍞", "🧊", "🍬", "🍭", "🥤", "🍌", "🍅", "🧀", "🥛", "🍪", "🚬", "🔥", "🛍️", "📦", "💡"];
let rapidos = [];
let editandoRapidos = false;
let rapidoEnEdicion = null;
let rapidoMonto = null;

// Sugerencias rápidas (además, la persona puede escribir cualquier emoji con su teclado)
$("sugerenciasIcono").innerHTML = ICONOS.filter(Boolean).map(i =>
  `<button type="button" class="btn btn-sm btn-outline-primary px-2" style="font-size: 1.2rem; line-height: 1.2;" data-ico="${i}">${i}</button>`).join("") +
  `<button type="button" class="btn btn-sm btn-outline-secondary" data-ico="">Sin ícono</button>`;
$("sugerenciasIcono").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ico]");
  if (b) $("rapIcono").value = b.dataset.ico;
});

// Deja solo el primer emoji (o carácter) que escriban, para que el botón no se deforme
function primerSimbolo(texto) {
  const t = (texto || "").trim();
  if (!t) return "";
  if (window.Intl && Intl.Segmenter) {
    const [primero] = new Intl.Segmenter("es", { granularity: "grapheme" }).segment(t);
    return primero ? primero.segment : "";
  }
  return Array.from(t)[0];
}
// Si escriben otro emoji encima, se queda con el último que eligieron
$("rapIcono").addEventListener("input", (e) => {
  const t = e.target.value.trim();
  const partes = window.Intl && Intl.Segmenter
    ? [...new Intl.Segmenter("es", { granularity: "grapheme" }).segment(t)].map(s => s.segment)
    : Array.from(t);
  e.target.value = partes.length ? partes[partes.length - 1] : "";
});

async function cargarRapidos() {
  const { data, error } = await db.from("productos").select("*").eq("es_rapido", true).eq("oculto", false).order("nombre");
  if (error) {
    $("gridRapidos").innerHTML = `<div class="small text-secondary">Corre <b>supabase_extras.sql</b> para activar los botones.</div>`;
    return;
  }
  rapidos = data || [];
  pintarRapidos();
}

function pintarRapidos() {
  const grid = $("gridRapidos");
  grid.classList.toggle("editando", editandoRapidos);
  let html = rapidos.map((r, i) => `
    <button type="button" class="btn-rapido" data-i="${i}">
      <span class="ico">${esc(r.icono || "")}</span>
      <span class="nom">${esc(r.nombre)}</span>
      <span class="pre">${r.precio_libre ? "por monto" : dinero(r.precio_venta)}</span>
    </button>`).join("");
  if (editandoRapidos || rapidos.length === 0) {
    html += `<button type="button" class="btn-rapido nuevo" data-nuevo="1"><span class="ico"><i class="bi bi-plus-lg"></i></span><span class="nom">Agregar botón</span></button>`;
  }
  grid.innerHTML = html;
  if (rapidos.length === 0 && !editandoRapidos) {
    grid.insertAdjacentHTML("beforeend", `<div class="small text-secondary align-self-center" style="grid-column: span 2;">Crea botones para lo que no trae código: tortillas, huevo por pieza, dulces sueltos…</div>`);
  }
}

$("gridRapidos").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-rapido");
  if (!btn) return;
  if (btn.dataset.nuevo) { abrirFormRapido(null); return; }
  const r = rapidos[+btn.dataset.i];
  if (editandoRapidos) { abrirFormRapido(r); return; }

  if (r.precio_libre) {
    abrirMonto(r);
  } else {
    agregarItem({ codigo: r.codigo_barras, nombre: r.nombre, precio: +r.precio_venta, costo: +r.costo_compra || 0 });
    scanStatus.innerHTML = `<span class="text-success fw-bold">Agregado: ${esc(r.nombre)}</span>`;
    resetFocus(); // para que la pistola siga leyendo códigos
  }
});

$("btnEditarRapidos").addEventListener("click", () => {
  editandoRapidos = !editandoRapidos;
  $("btnEditarRapidos").innerHTML = editandoRapidos ? `<i class="bi bi-check-lg me-1"></i>Listo` : `<i class="bi bi-gear me-1"></i>Editar`;
  $("btnEditarRapidos").className = `btn btn-sm ${editandoRapidos ? "btn-primary" : "btn-outline-primary"}`;
  if (!editandoRapidos) cerrarFormRapido();
  cerrarMonto();
  pintarRapidos();
});

// ---- Cobro por monto (ej. $15 de tortillas)
function abrirMonto(r) {
  rapidoMonto = r;
  $("montoNombre").textContent = r.nombre;
  $("montosRapidos").innerHTML = [10, 15, 20, 25, 30, 50].map(m =>
    `<button type="button" class="btn btn-outline-primary" data-monto="${m}">$${m}</button>`).join("");
  $("montoInput").value = "";
  $("panelMonto").classList.remove("d-none");
  cerrarFormRapido();
  $("montoInput").focus();
}
function cerrarMonto() { rapidoMonto = null; $("panelMonto").classList.add("d-none"); }

function agregarPorMonto(monto) {
  if (!rapidoMonto || !(monto > 0)) return;
  const r = rapidoMonto;
  // La ganancia se calcula con la proporción costo/precio que pusiste (ej. kilo a $22 que te cuesta $18)
  const proporcion = +r.precio_venta > 0 ? (+r.costo_compra || 0) / +r.precio_venta : 0;
  agregarItem({ codigo: r.codigo_barras, nombre: `${r.nombre} ($${monto})`, precio: monto, costo: Math.round(monto * proporcion * 100) / 100 });
  scanStatus.innerHTML = `<span class="text-success fw-bold">Agregado: ${esc(r.nombre)} por ${dinero(monto)}</span>`;
  cerrarMonto();
  resetFocus();
}
$("montosRapidos").addEventListener("click", (e) => { const b = e.target.closest("[data-monto]"); if (b) agregarPorMonto(+b.dataset.monto); });
$("btnAgregarMonto").addEventListener("click", () => agregarPorMonto(parseFloat($("montoInput").value)));
$("montoInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); agregarPorMonto(parseFloat($("montoInput").value)); } });
$("btnCancelarMonto").addEventListener("click", () => { cerrarMonto(); resetFocus(); });

// ---- Crear / editar / borrar botones
function etiquetasFormRapido() {
  const libre = $("rapLibre").checked;
  $("rapPrecioLabel").textContent = libre ? "Precio por kilo" : "Precio venta";
  $("rapCostoLabel").textContent = libre ? "Costo por kilo" : "Costo";
}
$("rapLibre").addEventListener("change", etiquetasFormRapido);

function abrirFormRapido(r) {
  rapidoEnEdicion = r;
  cerrarMonto();
  $("formRapidoTitulo").textContent = r ? `Editar "${r.nombre}"` : "Nuevo botón";
  $("rapIcono").value = r?.icono || "";
  $("rapNombre").value = r?.nombre || "";
  $("rapPrecio").value = r?.precio_venta ?? "";
  $("rapCosto").value = r?.costo_compra ?? "";
  $("rapLibre").checked = !!r?.precio_libre;
  $("btnBorrarRapido").classList.toggle("d-none", !r);
  etiquetasFormRapido();
  $("formRapido").classList.remove("d-none");
  $("rapNombre").focus();
}
function cerrarFormRapido() { rapidoEnEdicion = null; $("formRapido").classList.add("d-none"); }
$("btnCancelarRapido").addEventListener("click", cerrarFormRapido);

$("formRapido").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("rapNombre").value.trim();
  const precio = parseFloat($("rapPrecio").value);
  if (!nombre || !(precio > 0)) { alert("Pon nombre y precio."); return; }

  const datos = {
    nombre,
    icono: primerSimbolo($("rapIcono").value) || null,
    precio_venta: precio,
    costo_compra: parseFloat($("rapCosto").value) || 0,
    precio_libre: $("rapLibre").checked,
    es_rapido: true,
    oculto: false,
    updated_at: new Date().toISOString()
  };

  $("btnGuardarRapido").disabled = true;
  const { error } = rapidoEnEdicion
    ? await db.from("productos").update(datos).eq("codigo_barras", rapidoEnEdicion.codigo_barras)
    : await db.from("productos").insert({ ...datos, codigo_barras: "R-" + Date.now().toString(36).toUpperCase(), stock_actual: 0, stock_minimo: 0, foto_url: "" });
  $("btnGuardarRapido").disabled = false;

  if (error) { alert("No se guardó: " + error.message); return; }
  cerrarFormRapido();
  cargarRapidos();
});

$("btnBorrarRapido").addEventListener("click", async () => {
  const r = rapidoEnEdicion;
  if (!r || !confirm(`¿Quitar el botón "${r.nombre}"?`)) return;
  // Si ya tiene ventas no se puede borrar del todo; entonces solo se esconde
  const { error } = await db.from("productos").delete().eq("codigo_barras", r.codigo_barras);
  if (error) await db.from("productos").update({ oculto: true }).eq("codigo_barras", r.codigo_barras);
  cerrarFormRapido();
  cargarRapidos();
});
