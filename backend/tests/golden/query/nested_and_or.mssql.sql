SELECT TOP 2000 q_orders.id AS id 
FROM q_orders 
WHERE q_orders.status = 'paid' AND q_orders.total > 60 OR q_orders.status IS NULL ORDER BY [id] ASC
