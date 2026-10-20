SELECT TOP 2000 o.id AS id, c.name AS name 
FROM q_orders AS o JOIN q_customers AS c ON o.customer_id = c.id 
WHERE c.region = 'EU' ORDER BY o.id ASC
