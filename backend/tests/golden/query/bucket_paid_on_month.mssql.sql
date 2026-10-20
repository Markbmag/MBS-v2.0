SELECT TOP 2000 datefromparts(year(q_orders.paid_on), month(q_orders.paid_on), 1) AS period, count(*) AS n 
FROM q_orders GROUP BY datefromparts(year(q_orders.paid_on), month(q_orders.paid_on), 1) ORDER BY [period] ASC
