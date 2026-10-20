SELECT TOP 2000 avg(CAST(q_orders.qty AS FLOAT)) AS a, min(q_orders.created_at) AS first, count(q_orders.qty) AS n 
FROM q_orders
