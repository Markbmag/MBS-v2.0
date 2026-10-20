SELECT q_orders.customer_id AS customer_id, sum(q_orders.total) AS revenue 
FROM q_orders GROUP BY q_orders.customer_id 
HAVING sum(q_orders.total) > 60 ORDER BY "revenue" DESC 
 LIMIT 2000
