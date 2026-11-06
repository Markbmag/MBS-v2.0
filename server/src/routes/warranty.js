// Маршруты: гарантия.
// Код перенесён из server.js без изменений.

const express = require('express');
const { app } = require('../app');
const { BRIGADE_PASSWORD } = require('../config/passwords');
const { notesPool } = require('../db');

// ================== WARRANTY ==================

// Проверка пароля
app.post('/api/warranty/check-password', (req, res) => {
  const { password } = req.body;
  const correctPassword = BRIGADE_PASSWORD;
  if (password === correctPassword) {
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false, error: 'Неверный пароль' });
  }
});

// Загрузка Excel-данных
app.post('/api/warranty/upload', express.json({ limit: '100mb' }), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: 'Нет данных' });

    const normalizeKey = (str) => String(str).trim().toLowerCase().replace(/\s+/g, ' ');
    const getVal = (row, ...possibleNames) => {
      for (const name of possibleNames) {
        if (row[name] !== undefined) return row[name];
      }
      const rowNormalized = {};
      Object.keys(row).forEach(key => { rowNormalized[normalizeKey(key)] = row[key]; });
      for (const name of possibleNames) {
        const normName = normalizeKey(name);
        if (rowNormalized[normName] !== undefined) return rowNormalized[normName];
      }
      return undefined;
    };

    const parseDate = (val) => {
      if (val === undefined || val === null || val === '') return null;
      if (typeof val === 'number') {
        const date = new Date((val - 25569) * 86400 * 1000);
        return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
      }
      if (typeof val === 'string') {
        let d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        const parts = val.split('.');
        if (parts.length === 3) {
          d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        }
        return null;
      }
      return null;
    };

    const dayDiff = (d1, d2) => {
      if (!d1 || !d2) return 0;
      return Math.round((new Date(d1) - new Date(d2)) / 86400000);
    };

    // Формируем значения (без batch_number)
    const allValues = rows.map(row => {
      const vin_id = getVal(row, 'vin_id', 'VIN', 'vin', 'Vin ID') || '';
      const brand = getVal(row, 'brand', 'Brand', 'Марка') || '';
      const model = getVal(row, 'model', 'Model', 'Модель') || '';
      const production_date = parseDate(getVal(row, 'production_date', 'Production Date', 'Дата производства'));
      const sold_date = parseDate(getVal(row, 'sold date', 'sold_date', 'Sold Date', 'Дата продажи'));
      const claim_id = getVal(row, 'Claim ID', 'claim_id', 'ClaimID') || '';
      const document_number = getVal(row, 'Document Number', 'document_number', 'Doc Number') || '';
      const warranty_start_date = parseDate(getVal(row, 'warranty start date', 'warranty_start_date', 'Warranty Start'));
      const customer_complain_date = parseDate(getVal(row, 'Customer complain date', 'customer_complain_date', 'Complain Date'));
      const claims_qty = parseInt(getVal(row, 'Claims qty', 'claims_qty', 'Claims Qty')) || 0;
      const diagnostic_result = getVal(row, 'Diagnostic result', 'diagnostic_result', 'Diagnostic') || '';
      const main_part = getVal(row, 'Main part', 'main_part', 'Main Part') || '';
      const main_part_name = getVal(row, 'Main part name', 'main_part_name', 'Part Name') || '';
      const category = getVal(row, 'Категория', 'category', 'Category') || '';
      const totalPaid = parseFloat(getVal(row, 'Total amount paid to dealers RUR', 'total_amount_paid_dealers_rur', 'Стоимость', 'cost', 'Cost')) || 0;

      const qty_sell = vin_id ? 1 : 0;
      const delta = customer_complain_date && warranty_start_date ? dayDiff(customer_complain_date, warranty_start_date) : 0;
      const mis_0 = customer_complain_date && warranty_start_date ? (delta >= -60 && delta <= 7 ? 1 : 0) : 0;
      const mis_3 = customer_complain_date && warranty_start_date ? (delta >= -60 && delta <= 90 ? 1 : 0) : 0;
      const mis_0_count = mis_0 * claims_qty;
      const mis_3_count = mis_3 * claims_qty;
      const sold_cars_qty = vin_id ? 1 : 0;
      const unique_vin_by_qr = vin_id ? 1 : 0;

      return [
        vin_id, sold_cars_qty, unique_vin_by_qr, brand, model,
        production_date, sold_date, claim_id, document_number,
        warranty_start_date, customer_complain_date, claims_qty,
        diagnostic_result, main_part, main_part_name, mis_0, mis_3,
        qty_sell, delta, mis_0_count, mis_3_count, category, totalPaid
      ];
    });

    const sql = `
      INSERT INTO warranty_claims 
        (vin_id, sold_cars_qty, unique_vin_by_qr, brand, model, production_date, sold_date,
         claim_id, document_number, warranty_start_date, customer_complain_date, claims_qty,
         diagnostic_result, main_part, main_part_name, mis_0, mis_3, qty_sell, delta,
         mis_0_count, mis_3_count, category, total_amount_paid_dealers_rur)
      VALUES ?
    `;

    // Разбивка на батчи по 10000 строк
    const batchSize = 10000;
    let insertedCount = 0;

    for (let i = 0; i < allValues.length; i += batchSize) {
      const batch = allValues.slice(i, i + batchSize);
      await notesPool.query(sql, [batch]);
      insertedCount += batch.length;
    }

    res.json({ success: true, inserted: insertedCount });
  } catch (err) {
    console.error('Ошибка загрузки warranty:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение списка загрузок (по uploaded_at)
app.get('/api/warranty/upload-times', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT DISTINCT DATE_FORMAT(uploaded_at, '%Y-%m-%d %H:%i:%s') AS uploaded_at
      FROM warranty_claims
      WHERE uploaded_at IS NOT NULL
      ORDER BY uploaded_at DESC
    `);
    res.json(rows.map(r => r.uploaded_at));
  } catch (err) {
    console.error('Ошибка получения upload times:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение загруженных записей
app.get('/api/warranty/claims', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = 'SELECT * FROM warranty_claims';
    const params = [];
    if (uploadedAt) {
      sql += ' WHERE uploaded_at = ?';
      params.push(uploadedAt);
    }
    sql += ' ORDER BY id DESC LIMIT 1000';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения warranty claims:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Аналитика Total (Prod Related)
app.get('/api/warranty/analytics', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = `
      SELECT 
        DATE_FORMAT(production_date, '%Y-%m') AS month,
        model,
        SUM(qty_sell) AS qty_sell,
        SUM(mis_0_count) AS mis_0,
        SUM(mis_3_count) AS mis_3
      FROM warranty_claims
      WHERE production_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
        AND production_date IS NOT NULL
    `;
    const params = [];
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY month, model ORDER BY month, model';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка warranty аналитики:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Аналитика Model Based (Prod Related)
app.get('/api/warranty/analytics-by-model', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = `
      SELECT 
        DATE_FORMAT(production_date, '%Y-%m') AS month,
        model,
        SUM(qty_sell) AS qty_sell,
        SUM(mis_3_count) AS mis_3_count
      FROM warranty_claims
      WHERE production_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
        AND production_date IS NOT NULL
    `;
    const params = [];
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY month, model ORDER BY month, model';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка аналитики по моделям:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Аналитика 0 MIS/3MIS by sales date
app.get('/api/warranty/analytics-by-sales-date', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = `
      SELECT 
        DATE_FORMAT(warranty_start_date, '%Y-%m') AS month,
        model,
        SUM(qty_sell) AS qty_sell,
        SUM(mis_0_count) AS mis_0_count,
        SUM(mis_3_count) AS mis_3_count
      FROM warranty_claims
      WHERE warranty_start_date IS NOT NULL
    `;
    const params = [];
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY month, model ORDER BY month, model';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка аналитики по sales date:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Топ категорий
app.get('/api/warranty/categories-summary', async (req, res) => {
  try {
    const { model, uploadedAt } = req.query;
    let sql = `
      SELECT model, category, SUM(claims_qty) AS total_claims
      FROM warranty_claims
      WHERE category IS NOT NULL AND category != ''
    `;
    const params = [];
    if (model && model !== 'ALL') {
      sql += ' AND model = ?';
      params.push(model);
    }
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY model, category ORDER BY model, total_claims DESC';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения категорий:', err.message);
    res.status(500).json({ error: err.message });
  }
});
