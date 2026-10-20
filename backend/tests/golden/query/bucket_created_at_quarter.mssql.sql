SELECT TOP 2000 datefromparts(year(q_orders.created_at), (datepart(quarter, q_orders.created_at) - 1) * 3 + 1, 1) AS period, count(*) AS n 
FROM q_orders GROUP BY datefromparts(year(q_orders.created_at), (datepart(quarter, q_orders.created_at) - 1) * 3 + 1, 1) ORDER BY [period] ASC
